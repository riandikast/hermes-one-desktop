// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getYamlPath } from "./yaml-path";

const yaml = [
  "approvals:",
  "  mode: manual",
  "  deny:",
  '    - "rm -rf *"',
  '    - "git push --force"',
  "command_allowlist:",
  '  - "git status"',
  '  - "ls -la"',
  "terminal:",
  "  cwd: .",
  "memory:",
  '  write_approval: "true"',
].join("\n");

describe("getYamlPath block lists", () => {
  it("reads scalars as before", () => {
    expect(getYamlPath(yaml, "approvals.mode")).toBe("manual");
    expect(getYamlPath(yaml, "terminal.cwd")).toBe(".");
    expect(getYamlPath(yaml, "memory.write_approval")).toBe("true");
  });

  it("reads a nested block list into a JSON array string", () => {
    expect(getYamlPath(yaml, "approvals.deny")).toBe(
      '["rm -rf *","git push --force"]',
    );
  });

  it("reads a top-level block list into a JSON array string", () => {
    expect(getYamlPath(yaml, "command_allowlist")).toBe(
      '["git status","ls -la"]',
    );
  });

  it("returns null for a missing key", () => {
    expect(getYamlPath(yaml, "approvals.nope")).toBeNull();
  });

  it("returns null for an empty block (no items)", () => {
    expect(getYamlPath("approvals:\n  deny:\n", "approvals.deny")).toBeNull();
  });

  it("returns [] for an inline empty list", () => {
    expect(getYamlPath("approvals:\n  deny: []\n", "approvals.deny")).toBe(
      "[]",
    );
  });
});
