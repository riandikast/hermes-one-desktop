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

describe("native compression settings", () => {
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
