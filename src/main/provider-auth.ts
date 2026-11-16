import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { hasOAuthCredentials } from "./config";

export interface ProviderAuthStatus {
  /** A credential exists that the runtime can resolve. */
  configured: boolean;
  /** Which sign-in produced it. */
  source: "oauth" | "claude-cli" | "key" | "";
}

const claudeConfigDir = (): string =>
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** Claude Code's own login file; Hermes borrows it as a claude_code credential. */
export function claudeCliSignedIn(): boolean {
  try {
    const parsed = JSON.parse(
      readFileSync(join(claudeConfigDir(), ".credentials.json"), "utf8"),
    ) as { claudeAiOauth?: { accessToken?: unknown } };
    const token = parsed.claudeAiOauth?.accessToken;
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

/**
 * Credentials written outside this window.
 *
 * The Providers cards only reflected sign-ins started in the desktop, so a
 * `hermes auth add anthropic` in a terminal, an `.env` key, or a Claude Code
 * CLI login all looked "not connected" even though the runtime resolves them.
 */
export function providerAuthStatuses(
  profile?: string,
): Record<string, ProviderAuthStatus> {
  const anthropic = hasOAuthCredentials("anthropic", profile) === true;
  const claude = claudeCliSignedIn();
  return {
    anthropic: { configured: anthropic, source: anthropic ? "oauth" : "" },
    "claude-code": { configured: claude, source: claude ? "claude-cli" : "" },
  };
}
