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
