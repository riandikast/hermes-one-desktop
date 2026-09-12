import type { BrowserWindow } from "electron";
import { showApprovalDialog, showPasswordDialog } from "./askpass";

/**
 * Mid-turn gateway credential prompts (`sudo.request` / `secret.request`).
 *
 * Unlike `clarify.request` — which renders an inline card in the chat
 * transcript — a sudo password or a secret value is sensitive and must NEVER
 * land in scrollback. So these reuse the installer's hardened askpass modal
 * (`showPasswordDialog`): CSP-locked `default-src 'none'`, sandboxed, ephemeral
 * data-URL, the value never persisted.
 *
 * Gateway protocol (NousResearch/hermes-agent, tui_gateway/server.py), keyed by
 * request_id:
 *   sudo.request   {}                          -> sudo.respond   { request_id, password }
 *   secret.request { prompt, env_var, ... }     -> secret.respond { request_id, value }
 * An empty answer is a safe "skip": the gateway treats secret.request as
 * skipped and lets a terminal sudo prompt fail cleanly, so cancel maps to "".
 */

let parentWindowGetter: () => BrowserWindow | null = () => null;

/**
 * Presentation order for approval buttons (mirrors the official desktop:
 * one-shot run first, then the scoped grants, then the destructive deny).
 * Anything the backend did not offer is filtered out before rendering.
 */
const APPROVAL_CHOICE_ORDER = ["once", "session", "always", "deny"] as const;

const APPROVAL_CHOICE_LABELS: Record<string, string> = {
  once: "Run once",
  session: "Allow for this session",
  always: "Always allow",
  deny: "Deny",
};

/** Wire the provider that returns the window to parent the modal to. Called
 *  once from index.ts after the main window is created. */
export function setGatewayPromptParent(
  getter: () => BrowserWindow | null,
): void {
  parentWindowGetter = getter;
}

/**
 * Prompt for the sudo password. Resolves with the password, or "" if the user
 * cancels (safe skip — terminal sudo then fails cleanly rather than hanging).
 */
export async function promptSudoPassword(): Promise<string> {
  const parent = parentWindowGetter();
  const value = await showPasswordDialog(
    parent,
    "An agent command needs administrator (sudo) access to continue. " +
      "Your password is sent only to the local sudo prompt and is never stored.",
    {
      title: "Administrator Password Required",
      heading: "Hermes needs your sudo password",
    },
  );
  return value ?? "";
}

/**
 * Prompt for a named secret the agent requested (e.g. an API key it needs to
 * store). Resolves with the value, or "" if the user cancels (safe skip — the
 * gateway records the secret as skipped).
 */
export async function promptSecretValue(
  envVar: string,
  prompt: string,
): Promise<string> {
  const parent = parentWindowGetter();
  const detail =
    (prompt && prompt.trim()) ||
    `The agent is requesting a value for ${envVar || "a secret"}.`;
  const value = await showPasswordDialog(parent, detail, {
    title: "Secret Required",
    heading: envVar
      ? `Hermes needs a value for ${envVar}`
      : "Hermes needs a secret value",
  });
  return value ?? "";
}

/**
 * Mid-turn dangerous-command / execute_code approval (`approval.request`).
 *
 * Unlike sudo/secret (sensitive values that must never reach scrollback), the
 * approval decision itself is not a secret — what matters is that it is
 * *visible and answerable*. The gateway parks the agent thread on this request
 * until it is answered (approval timeout, ~5 min), so an unanswered prompt
 * shows up to the user as a command that simply hangs.
 *
 * A dedicated Electron modal is the right surface here: it appears even when the chat
 * window is busy streaming or focused on another tile, it cannot be missed
 * behind the transcript, and `flashFrame` marks the taskbar icon so the prompt
 * is noticed when the app is in the background.
 *
 * Returns one of `once` | `session` | `always` | `deny`. Closing the dialog or
 * pressing Escape resolves to `deny` — an unanswered approval must never be
 * read as consent.
 */
export interface ApprovalPromptOptions {
  /** Backend-offered choices; anything not offered is not shown. */
  choices?: string[];
  command?: string;
  description?: string;
}

export async function promptApproval(
  opts: ApprovalPromptOptions = {},
): Promise<string> {
  const parent = parentWindowGetter();
  const requested = opts.choices?.length ? opts.choices : ["once", "deny"];
  // Fixed presentation order (safe affirmative → scoped grants → deny) so the
  // button row does not reshuffle between prompts.
  const offered = APPROVAL_CHOICE_ORDER.filter((choice) =>
    requested.includes(choice),
  );
  const choices = offered.length > 0 ? offered : ["once", "deny"];

  const command = (opts.command ?? "").trim();
  const description =
    (opts.description ?? "").trim() ||
    "The agent wants to run a command that needs your approval.";

  // Escape / window-close resolve to the DENY entry, and the dialog's default
  // (Enter) button is Deny too: a dangerous command must require a deliberate
  // click, never a stray keypress.


  if (parent) {
    try {
      parent.flashFrame(true);
    } catch {
      /* non-fatal */
    }
  }

  try {
    return await showApprovalDialog(parent, {
      choices,
      command,
      description,
      labels: APPROVAL_CHOICE_LABELS,
    });
  } finally {
    if (parent) {
      try {
        parent.flashFrame(false);
      } catch {
        /* non-fatal */
      }
    }
  }
}
