import { describe, it, expect, vi } from "vitest";
import { OFFICIAL_DEFAULT_PROVIDERS, OFFICIAL_PROVIDERS, officialProvider } from "../src/shared/official-providers";
import { PROVIDERS, OAUTH_PROVIDERS, SETTINGS_SECTIONS, providerRouteForEnvKey } from "../src/renderer/src/constants";
import { canonicalProviderBaseUrl } from "../src/main/provider-registry";
import { providerDoesNotNeedApiKey } from "../src/main/providers";
vi.mock("fs", async (importOriginal) => { const actual = await importOriginal<typeof import("fs")>(); const methods = { existsSync: vi.fn(), readFileSync: vi.fn() }; return { ...actual, ...methods, default: { ...actual, ...methods } }; });
import { existsSync, readFileSync } from "fs";
import { providerSetupError } from "../src/main/provider-support";

describe("pinned official provider defaults", () => {
  it("covers every visible registry/profile identity, preserving hidden Solstice exclusion", () => {
    expect(OFFICIAL_PROVIDERS).toHaveLength(51);
    expect(OFFICIAL_DEFAULT_PROVIDERS).toHaveLength(50);
    for (const p of OFFICIAL_DEFAULT_PROVIDERS) {
      expect(PROVIDERS.options.some(o => o.value === p.id), p.id).toBe(true);
      expect(PROVIDERS.setup.some(o => o.id === p.id), p.id).toBe(true);
      if (p.oauth) expect(OAUTH_PROVIDERS.some(o => o.id === p.id), p.id).toBe(true);
      const primary = p.envKeys[0];
      if (primary) {
        expect(SETTINGS_SECTIONS[0].items.some(f => f.key === primary), p.id).toBe(true);
        // Shared secondary env vars must not steal a primary provider identity.
        const owner = OFFICIAL_DEFAULT_PROVIDERS.find(o => o.envKeys[0] === primary)!;
        expect(providerRouteForEnvKey(primary).provider, p.id).toBe(owner.id);
      }
    }
    expect(PROVIDERS.options.some(o => o.value === "solstice")).toBe(false);
    expect(new Set(PROVIDERS.options.map(o => o.value)).size).toBe(PROVIDERS.options.length);
    expect(new Set(PROVIDERS.setup.map(o => o.id)).size).toBe(PROVIDERS.setup.length);
  });
  it("routes native Fireworks ahead of its legacy compatible preset", () => {
    expect(providerRouteForEnvKey("FIREWORKS_API_KEY")).toEqual({ provider: "fireworks", baseUrl: "" });
    expect(providerRouteForEnvKey("ARCEEAI_API_KEY")).toEqual({ provider: "arcee", baseUrl: "" });
    expect(officialProvider("ramp-router")?.id).toBe("router");
    expect(canonicalProviderBaseUrl("router")).toBe("https://api.router.com/v1");
    expect(canonicalProviderBaseUrl("minimax-cn")).toBe("https://api.minimaxi.com/anthropic");
    expect(canonicalProviderBaseUrl("gemini")).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(canonicalProviderBaseUrl("unknown-private-provider")).toBeNull();
  });
  it("accepts installed backend source formats without importing runtime or reading user state", async () => {
    const actual = await vi.importActual<typeof import("fs")>("fs");
    const repo = "C:/Users/riand/AppData/Local/hermes/hermes-agent";
    if (!actual.existsSync(repo + "/hermes_cli/auth.py")) return;
    vi.mocked(existsSync).mockImplementation(actual.existsSync);
    vi.mocked(readFileSync).mockImplementation(actual.readFileSync);
    for (const p of OFFICIAL_DEFAULT_PROVIDERS) {
      expect(providerSetupError(repo, p.id), p.id).toBeNull();
    }
    expect(providerSetupError(repo, "anthropic", true)).toBeNull();
    expect(providerSetupError(repo, "openrouter", true)).toBeNull();
  });
  it("never requires static API keys for OAuth/cloud SDK providers", () => {
    for (const p of OFFICIAL_DEFAULT_PROVIDERS.filter(p => p.auth !== "api_key")) {
      expect(providerDoesNotNeedApiKey(p.id), p.id).toBe(true);
    }
  });
  it("fails explicitly for missing backend provider and OAuth capabilities", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('_REGISTRY_ROWS = (("openrouter",),)\nfrom hermes_cli.auth_plugin_providers');
    expect(providerSetupError("fixture", "router")).toMatch(/does not support/);
    expect(providerSetupError("fixture", "openrouter")).toBeNull();
    expect(providerSetupError("fixture", "openrouter", true)).toMatch(/does not support OAuth/);
    vi.mocked(readFileSync).mockImplementation((path) => String(path).endsWith("auth_commands.py")
      ? '_OAUTH_CAPABLE_PROVIDERS = {"openrouter", "anthropic"}'
      : '_REGISTRY_ROWS = (("openrouter",),)\nfrom hermes_cli.auth_plugin_providers');
    expect(providerSetupError("fixture", "openrouter", true)).toBeNull();
    expect(providerSetupError("fixture", "existing-private-provider")).toBeNull();
    expect(providerSetupError("fixture", "google-gemini-cli", true)).toMatch(/cannot verify OAuth/);
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error("missing"); });
    expect(providerSetupError("fixture", "router")).toMatch(/Cannot verify/);
  });
});
