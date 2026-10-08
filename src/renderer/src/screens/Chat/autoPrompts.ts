/**
 * Detecting INJECTED user rows — auto-prompts and system notices that the
 * backend writes into the transcript with `role='user'`.
 *
 * WHY THIS EXISTS: the "last prompt" chip reads the newest `role="user"` row,
 * but not every one of those is something the USER typed. The runtime injects
 * its own rows into the same stream — background-process completion notices,
 * async delegation batch reports, context-compaction handoffs, model-change
 * notices, out-of-band relay pastes. These land AFTER the user's real prompt,
 * so the chip showed the injection instead of the prompt the user actually
 * wrote ("last prompt got mixed by auto background task report prompt").
 *
 * WHY A PREFIX ALLOWLIST AND NOT "starts with `[`": a real user can legitimately
 * begin a message with a bracket ("[bug] the dialog..."). A blanket bracket rule
 * would silently hide a genuine prompt — worse than the bug. Matching only the
 * KNOWN generated prefixes keeps a real prompt safe: the cost of an unlisted
 * future marker is that one injection shows up, not that a real prompt vanishes.
 *
 * EVIDENCE (the user's real state.db, 4,024 user rows): 1,454 rows matched these
 * prefixes, and the ONLY bracketed rows left over were 2 bridge-relay pastes
 * ("[8/27/2026 1:11 PM] Andika: /sessions"), which are also injected — captured
 * by RELAY_PREFIX_RE below. Zero genuine user prompts were bracketed in that
 * corpus, and the relay regex matched no non-relay row.
 *
 * KEEP THIS IN SYNC with the runtime's injectors. If a new notice appears, add
 * its prefix here (and a test) rather than loosening to a blanket rule.
 */

/** Exact leading markers of rows the runtime writes as `role='user'`. */
const AUTO_PROMPT_PREFIXES = [
  "[System:", // model-change notice, tool-call-too-large, network cut-off
  "[System note", // interrupted mid-run, resume notes
  "[IMPORTANT:", // background-process completion, skill invocation
  "[ASYNC DELEGATION BATCH COMPLETE", // subagent fan-out results (the reported one)
  "[CONTEXT COMPACTION", // "REFERENCE ONLY" handoff summary
  "[Your active task list was preserved", // task list carried over compaction
  "[OUT-OF-BAND USER MESSAGE", // relayed direct message
  "[STILL IN PROGRESS", // active request restated after compaction
  "[plugin:", // dev-server plugin output
  "[Package Manager Window]", // editor/package-manager noise
] as const;

/**
 * Bridge-relay paste: `[M/D/YYYY H:MM AM/PM] Name: text` — a chat relay
 * forwarding a conversation, not something the user typed here. Anchored and
 * specific enough not to catch a user's own bracketed message.
 */
const RELAY_PREFIX_RE =
  /^\[\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\]\s*[^:\n]{1,40}:/i;

/**
 * Is this user-authored row actually a runtime injection?
 *
 * Whitespace-tolerant on the leading edge (the rows are stored with a leading
 * newline or spaces in some cases) and case-sensitive for the bracketed forms,
 * because every observed marker is written in that exact capitalization.
 */
export function isAutoInjectedPrompt(content: string): boolean {
  const text = String(content ?? "").replace(/^\s+/, "");
  if (!text) return false;
  if (RELAY_PREFIX_RE.test(text)) return true;
  return AUTO_PROMPT_PREFIXES.some((p) => text.startsWith(p));
}
