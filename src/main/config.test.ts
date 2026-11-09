// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let configFile: string;
let config: typeof import("./config");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "hermes-config-test-"));
  configFile = join(home, "config.yaml");
  writeFileSync(configFile, "approvals:\n  mode: manual\n");
  vi.stubEnv("HERMES_HOME", home);
  vi.resetModules();
  config = await import("./config");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
});

describe("object-list round trip (fallback_providers)", () => {
  it("reads back exactly what the writer emitted", () => {
    writeFileSync(configFile, "approvals:\n  mode: manual\n");
    const chain = [
      { provider: "custom", model: "local-model", base_url: "http://127.0.0.1:1234/v1" },
      { provider: "openrouter", model: "a/two" },
    ];
    expect(config.setConfigValue("fallback_providers", JSON.stringify(chain))).toBeUndefined();
    expect(config.getConfigObjectList("fallback_providers")).toEqual(chain);
  });

  it("reads an empty inline list and a missing key as empty", () => {
    writeFileSync(configFile, "fallback_providers: []\n");
    expect(config.getConfigObjectList("fallback_providers")).toEqual([]);
    expect(config.getConfigObjectList("not_there")).toEqual([]);
  });

  it("stops at the next top-level key and skips comments", () => {
    writeFileSync(
      configFile,
      "fallback_providers:\n  # ordered\n  - provider: \"a\"\n    model: \"b\"\n\nmodel:\n  provider: main\n",
    );
    expect(config.getConfigObjectList("fallback_providers")).toEqual([
      { provider: "a", model: "b" },
    ]);
  });
});

describe("native compression settings", () => {
  // @lat: [[advanced-memory-settings#Controls and persistence]]
  it("preserves native Advanced and Memory scalar types and siblings", () => {
    writeFileSync(configFile, "memory:\n  provider: old\ncompression:\n  enabled: true\n");
    config.setConfigValue("memory.memory_enabled", "false");
    config.setConfigValue("memory.memory_char_limit", "3200");
    config.setConfigValue("compression.threshold", "0.8");
    config.setConfigValue("agent.max_turns", "null");
    config.setConfigValue("agent.tool_use_enforcement", "false");
    expect(readFileSync(configFile, "utf8")).toContain("memory_enabled: false");
    expect(readFileSync(configFile, "utf8")).toContain("memory_char_limit: 3200");
    expect(readFileSync(configFile, "utf8")).toContain("threshold: 0.8");
    expect(readFileSync(configFile, "utf8")).toContain("max_turns: null");
    expect(readFileSync(configFile, "utf8")).toContain("tool_use_enforcement: false");
    expect(config.getConfigValue("memory.provider")).toBe("old");
  });

  it.each(["", "auxiliary:\n  vision:\n    timeout: 60\n", "auxiliary:\n  compression:\n    model: small\n"])("creates only the curated auxiliary timeout path safely", (initial) => {
    writeFileSync(configFile, initial);
    config.setConfigValue("auxiliary.compression.timeout", "240");
    expect(config.getConfigValue("auxiliary.compression.timeout")).toBe("240");
    if (initial.includes("vision")) expect(config.getConfigValue("auxiliary.vision.timeout")).toBe("60");
    if (initial.includes("model")) expect(config.getConfigValue("auxiliary.compression.model")).toBe("small");
    config.setConfigValue("auxiliary.compression.timeout", "300");
    expect(config.getConfigValue("auxiliary.compression.timeout")).toBe("300");
  });

  it("rejects invalid native scalars without touching configuration", () => {
    const before = readFileSync(configFile, "utf8");
    for (const [key, value] of [["memory.memory_enabled", "yes"], ["compression.threshold", "2"], ["agent.api_max_retries", "1.5"]]) {
      expect(() => config.setConfigValue(key, value)).toThrow();
    }
    expect(readFileSync(configFile, "utf8")).toBe(before);
  });

  it("refuses inline section duplication", () => {
    writeFileSync(configFile, "memory: {}\n");
    expect(() => config.setConfigValue("memory.memory_enabled", "false")).toThrow();
    expect(readFileSync(configFile, "utf8")).toBe("memory: {}\n");
  });

  it("writes a real boolean and integer without changing sibling settings", () => {
    writeFileSync(configFile, "compression:\n  enabled: true\n  protect_last_n: 20\n  threshold_tokens: null\n");
    config.setConfigValue("compression.enabled", "false");
    config.setConfigValue("compression.threshold_tokens", "150000");
    expect(readFileSync(configFile, "utf8")).toBe("compression:\n  enabled: false\n  protect_last_n: 20\n  threshold_tokens: 150000\n");
    expect(config.getConfigValue("compression.enabled")).toBe("false");
  });

  it("appends native scalars and clears the cap with YAML null", () => {
    config.setConfigValue("compression.enabled", "true");
    config.setConfigValue("compression.threshold_tokens", "null");
    expect(readFileSync(configFile, "utf8")).toContain("compression:\n  enabled: true\n  threshold_tokens: null\n");
  });

  it.each([["compression.enabled", "yes"], ["compression.threshold_tokens", "-1"], ["compression.threshold_tokens", "1.5"]])("rejects invalid %s=%s without changing the config", (key, value) => {
    const before = readFileSync(configFile, "utf8");
    expect(() => config.setConfigValue(key, value)).toThrow();
    expect(readFileSync(configFile, "utf8")).toBe(before);
  });
});

describe("config list round-trip (security pane)", () => {
  it("writes a top-level list and reads it back as JSON", () => {
    config.setConfigValue("command_allowlist", '["git status","ls -la"]');
    expect(config.getConfigValue("command_allowlist")).toBe(
      '["git status","ls -la"]',
    );
  });

  it("writes a nested list under an existing parent and reads it back", () => {
    config.setConfigValue("approvals.deny", '["rm -rf *","git push --force"]');
    expect(config.getConfigValue("approvals.deny")).toBe(
      '["rm -rf *","git push --force"]',
    );
  });

  it("rewrites an existing nested list in place", () => {
    writeFileSync(
      configFile,
      'approvals:\n  mode: manual\n  deny:\n    - "old rule"\n',
    );
    config.setConfigValue("approvals.deny", '["new rule"]');
    expect(config.getConfigValue("approvals.deny")).toBe('["new rule"]');
    expect(config.getConfigValue("approvals.mode")).toBe("manual");
  });

  it("clears a list by writing an empty array", () => {
    config.setConfigValue("approvals.deny", "[]");
    expect(config.getConfigValue("approvals.deny")).toBe("[]");
  });

  it("writes a list when the config file is empty", () => {
    writeFileSync(configFile, "");
    config.setConfigValue("command_allowlist", '["git status"]');
    expect(config.getConfigValue("command_allowlist")).toBe('["git status"]');
  });

  it("does not disturb sibling keys when appending a nested list", () => {
    config.setConfigValue("approvals.deny", '["rm -rf *"]');
    const content = readFileSync(configFile, "utf-8");
    expect(content).toContain("mode: manual");
    expect(content).toContain('deny:');
  });
});
