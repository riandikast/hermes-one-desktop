// @vitest-environment jsdom
/**
 * The picker's fallback list is AUTHORITATIVE: it must be published into
 * `config.yaml` `fallback_providers`, because that is what the backend gateway
 * actually reads when it fails a turn over.
 *
 * The bug this pins: the picker edited localStorage while the gateway read
 * config, so the two lists were independent. A failed turn could switch to a
 * model the user never listed, and the dialog could not show what would fire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackFromRow,
  publishFallbackChainToConfig,
  type FallbackModel,
} from "./fallbackModels";

function row(provider: string, model: string, baseUrl: string, label: string): FallbackModel {
  return fallbackFromRow({ provider, model, baseUrl, label });
}

function stubSetConfig(): ReturnType<typeof vi.fn> {
  const setConfig = vi.fn(
    async (_key: string, _value: string, _profile?: string) => true,
  );
  (window as unknown as { hermesAPI: unknown }).hermesAPI = { setConfig };
  return setConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publishFallbackChainToConfig", () => {
  it("writes the picker's models where the backend reads them", async () => {
    const setConfig = stubSetConfig();
    const chain = [
      row("custom", "cbai/glm-5.4", "http://localhost:20128/v1", "GLM 5.4"),
      row("custom", "ocg/kimi-k3", "http://localhost:20128/v1", "Kimi K3"),
    ];

    await expect(publishFallbackChainToConfig(chain, "default")).resolves.toBe(true);

    expect(setConfig).toHaveBeenCalledTimes(1);
    const call = setConfig.mock.calls[0]!;
    const [key, value, profile] = call as unknown as [string, string, string | undefined];
    expect(key).toBe("fallback_providers");
    expect(profile).toBe("default");

    // The payload must be entries the backend keeps — provider/model plus the
    // routing base_url. A missing base_url re-routes a local chain to a public
    // endpoint, which is the #89184 failure.
    expect(JSON.parse(value as string)).toEqual([
      {
        provider: "custom",
        model: "cbai/glm-5.4",
        base_url: "http://localhost:20128/v1",
      },
      {
        provider: "custom",
        model: "ocg/kimi-k3",
        base_url: "http://localhost:20128/v1",
      },
    ]);
  });

  it("clears the key when the picker list is empty", async () => {
    const setConfig = stubSetConfig();

    await publishFallbackChainToConfig([], "default");

    // "[]" is an instruction, not a no-op: a stale backend chain must not
    // outlive the picker list that the user emptied.
    expect(setConfig).toHaveBeenCalledWith("fallback_providers", "[]", "default");
  });

  it("drops half-filled rows instead of writing unusable entries", async () => {
    const setConfig = stubSetConfig();
    const chain = [
      row("custom", "good/one", "http://localhost:20128/v1", "One"),
      { key: "k", provider: "", model: "orphan", baseUrl: "", label: "Orphan" },
    ];

    await publishFallbackChainToConfig(chain);

    const entries = JSON.parse(setConfig.mock.calls[0]![1] as unknown as string);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe("good/one");
  });

  it("never throws when the bridge is missing or the write fails", async () => {
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {};
    await expect(publishFallbackChainToConfig([row("a", "b", "", "B")])).resolves.toBe(false);

    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      setConfig: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };
    await expect(publishFallbackChainToConfig([row("a", "b", "", "B")])).resolves.toBe(false);
  });
});
