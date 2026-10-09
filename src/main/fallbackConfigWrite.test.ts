// @vitest-environment node
/**
 * The dialog's fallback list must reach the backend as REAL YAML mappings.
 *
 * If `fallback_providers` is written as a block list of quoted scalars (what
 * the generic `setConfigListValue` does), the backend's `_iter_fallback_entries`
 * drops every entry — the chain resolves to `[]`, failover silently never
 * fires, while the UI still shows a configured chain. This test pins the
 * object-list shape, and the round-trip assertion is the one that matters.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configFile: string;

// `setConfigValue` resolves the file through `profilePaths(profile)`, so the
// test points that module at a scratch profile home.
vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    profilePaths: (profile?: string) => ({
      configFile: join(scratchDir, "config.yaml"),
      profileHome: scratchDir,
      profile: profile ?? "default",
    }),
  };
});

let scratchDir = "";

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "fbcfg-"));
  configFile = join(scratchDir, "config.yaml");
  writeFileSync(
    configFile,
    [
      "model:",
      "  provider: nous",
      "providers: {}",
      "fallback_providers: []",
      "plugins:",
      "  enabled:",
      "    - security-guidance",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  vi.resetModules();
});

describe("fallback_providers written from the dialog", () => {
  it("writes real YAML mappings, not stringified objects", async () => {
    const { setConfigValue } = await import("./config");
    const chain = [
      {
        provider: "custom",
        model: "cbai/glm-5.4",
        base_url: "http://localhost:20128/v1",
        key_env: "CUSTOM_PROVIDER_CUSTOM_KEY",
      },
      {
        provider: "custom",
        model: "ocg/kimi-k3",
        base_url: "http://localhost:20128/v1",
        key_env: "CUSTOM_PROVIDER_CUSTOM_KEY",
      },
    ];
    setConfigValue("fallback_providers", JSON.stringify(chain));

    const written = readFileSync(configFile, "utf-8");

    // The defect this guards: a scalar-quoted object would appear here.
    expect(written).not.toContain("\"{'provider'");
    expect(written).not.toContain('[object Object]');

    // Entries must be mappings with the routing keys preserved.
    expect(written).toMatch(/fallback_providers:\s*\n\s+- provider: "custom"/);
    expect(written).toContain('model: "cbai/glm-5.4"');
    expect(written).toContain('base_url: "http://localhost:20128/v1"');
    expect(written).toContain('key_env: "CUSTOM_PROVIDER_CUSTOM_KEY"');
    expect(written).toContain('model: "ocg/kimi-k3"');

    // Sibling keys survive the in-place block replacement.
    expect(written).toContain("plugins:");
    expect(written).toContain("- security-guidance");
    expect(written).toContain("providers: {}");
    // The key appears exactly once (no duplicate block appended).
    expect(written.match(/^fallback_providers:/gm)).toHaveLength(1);
  });

  it("clears the chain to an empty list without leaving a stale block", async () => {
    const { setConfigValue } = await import("./config");
    setConfigValue(
      "fallback_providers",
      JSON.stringify([{ provider: "custom", model: "a/b" }]),
    );
    setConfigValue("fallback_providers", "[]");

    const written = readFileSync(configFile, "utf-8");
    expect(written).toMatch(/fallback_providers: \[\]/);
    expect(written).not.toContain("model: \"a/b\"");
    expect(written).toContain("plugins:");
  });

  it("replaces an existing block instead of appending under it", async () => {
    const { setConfigValue } = await import("./config");
    setConfigValue(
      "fallback_providers",
      JSON.stringify([{ provider: "custom", model: "one/1" }]),
    );
    setConfigValue(
      "fallback_providers",
      JSON.stringify([
        { provider: "custom", model: "two/2" },
        { provider: "custom", model: "three/3" },
      ]),
    );

    const written = readFileSync(configFile, "utf-8");
    expect(written).not.toContain("one/1");
    expect(written).toContain("two/2");
    expect(written).toContain("three/3");
    expect(written.match(/^fallback_providers:/gm)).toHaveLength(1);
    // The block did not bleed into the sibling that follows it.
    expect(written).toContain("plugins:");
    expect(written).toContain("- security-guidance");
  });
});
