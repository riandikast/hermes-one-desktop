// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hasOAuthCredentials = vi.fn();
vi.mock("./config", () => ({ hasOAuthCredentials }));

let home: string;
let previous: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "provider-auth-"));
  previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  hasOAuthCredentials.mockReset();
});

afterEach(() => {
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previous;
  rmSync(home, { recursive: true, force: true });
});

it("detects a Claude Code CLI login from its own credential file", async () => {
  const { providerAuthStatuses, claudeCliSignedIn } = await import("./provider-auth");
  expect(claudeCliSignedIn()).toBe(false);
  expect(providerAuthStatuses().anthropic).toEqual({ configured: false, source: "" });

  writeFileSync(join(home, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "cc-token" } }));
  expect(claudeCliSignedIn()).toBe(true);
  expect(providerAuthStatuses()["claude-code"]).toEqual({ configured: true, source: "claude-cli" });
});

it("reports a hermes auth credential behind the Anthropic card", async () => {
  const { providerAuthStatuses } = await import("./provider-auth");
  hasOAuthCredentials.mockReturnValue(true);
  expect(providerAuthStatuses("work").anthropic).toEqual({ configured: true, source: "oauth" });
  expect(hasOAuthCredentials).toHaveBeenCalledWith("anthropic", "work");
});

it("ignores a credential file without an access token", async () => {
  const { claudeCliSignedIn } = await import("./provider-auth");
  mkdirSync(join(home, "nested"), { recursive: true });
  writeFileSync(join(home, ".credentials.json"), JSON.stringify({ claudeAiOauth: {} }));
  expect(claudeCliSignedIn()).toBe(false);
  writeFileSync(join(home, ".credentials.json"), "not json");
  expect(claudeCliSignedIn()).toBe(false);
});
