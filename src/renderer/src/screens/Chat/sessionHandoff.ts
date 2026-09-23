import type { ChatMessage } from "../types";
import { isBubbleMessage, normalizeMessageText } from "./chatMessages";

/**
 * "New session with context" — builds the compact handoff block seeded into a
 * fresh session so work continues without dragging the whole transcript along.
 *
 * Why not copy the transcript verbatim: long-session lag is dominated by the
 * desktop's per-render transcript work (whole-history reads + reconciliation),
 * which compaction cannot fix because it only shrinks the MODEL's window. The
 * handoff carries the active working state instead:
 *
 *   - the last N turns verbatim (user + assistant bubbles, errors kept)
 *   - a one-line outline of every earlier user prompt (cheap, high signal)
 *   - TODO/pinned notes if the user pinned bubbles in the old session
 *
 * The block renders as ONE user bubble in the new session. The dashboard
 * transport already forwards `session.create { messages }` seeds to the agent,
 * so the model receives the handoff on its first prompt with zero transport
 * changes.
 */

/** Verbatim turns kept at the tail of the handoff. */
const TAIL_TURNS = 10;

/** Hard cap per outlined prompt line (characters). */
const OUTLINE_LINE_MAX = 160;

export interface HandoffInfo {
  /** Title suggestion derived from the first user prompt. */
  title: string;
  /** Number of earlier prompts that were outlined (not carried verbatim). */
  outlinedCount: number;
  /** Number of recent turns carried verbatim. */
  tailCount: number;
}

interface HandoffResult {
  /** The single seed bubble for the new session. */
  message: ChatMessage;
  info: HandoffInfo;
}

function firstLine(text: string, max = OUTLINE_LINE_MAX): string {
  const line = normalizeMessageText(text).replace(/[#*`>]/g, "").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

export function buildSessionHandoff(messages: readonly ChatMessage[]): HandoffResult {
  const bubbles = messages.filter(isBubbleMessage);

  // Split into (turn = user bubble + everything after it up to the next user).
  const turns: Array<{ user: string; assistant: string[]; error?: string }> = [];
  let current: { user: string; assistant: string[]; error?: string } | null = null;
  for (const m of bubbles) {
    if (m.localOnly) continue;
    if (m.role === "user") {
      if (current) turns.push(current);
      current = { user: m.content, assistant: [] };
      continue;
    }
    // Agent-side bubble (skip streaming placeholders and pure tool noise).
    if (!current) continue;
    const text = normalizeMessageText(m.content);
    if (!text && !m.error) continue;
    if (m.error) current.error = m.error;
    if (text) current.assistant.push(text);
  }
  if (current) turns.push(current);

  const outlined = turns.slice(0, Math.max(0, turns.length - TAIL_TURNS));
  const tail = turns.slice(Math.max(0, turns.length - TAIL_TURNS));

  const parts: string[] = [];
  parts.push(
    "## Session handoff",
    "",
    "This is a continuation of a previous conversation that was moved to a fresh session for performance. Treat everything below as established context — do not re-derive it and do not ask for it again.",
  );

  if (outlined.length > 0) {
    parts.push("", "### Earlier in that conversation (summarized)", "");
    for (const t of outlined) {
      const line = firstLine(t.user);
      if (line) parts.push(`- ${line}`);
    }
  }

  if (tail.length > 0) {
    parts.push("", "### Most recent exchanges (verbatim)", "");
    for (const t of tail) {
      parts.push(`**User:** ${t.user.trim()}`);
      if (t.assistant.length > 0) {
        // Keep the tail verbatim but bounded — the latest answer is the live
        // working state; earlier answers inside the window collapse to their
        // last paragraph to stay useful without ballooning the seed.
        const last = t.assistant[t.assistant.length - 1];
        parts.push(`**Assistant:** ${firstLine(last, 600)}`);
      }
      if (t.error) parts.push(`**Last error:** ${t.error}`);
      parts.push("");
    }
  }

  parts.push(
    "### Continuation rules",
    "",
    "- Continue the work from the most recent exchange above.",
    "- Files and context folders carry over unchanged; no re-exploration needed.",
    "- If something material is missing from this handoff, say so explicitly instead of guessing.",
  );

  const firstUser = turns.find((t) => normalizeMessageText(t.user))?.user ?? "";
  const title = firstLine(firstUser, 60) || "Continued session";

  const message: ChatMessage = {
    id: `handoff-${Date.now()}`,
    role: "user",
    content: parts.join("\n"),
  };

  return {
    message,
    info: {
      title,
      outlinedCount: outlined.length,
      tailCount: tail.length,
    },
  };
}
