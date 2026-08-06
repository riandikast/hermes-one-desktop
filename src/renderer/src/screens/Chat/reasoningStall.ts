/**
 * Reasoning growth tracker (module scope).
 *
 * The answer bubble must not start typing while its turn's thought is still
 * streaming ("partial thought -> partial response" reads as a leak). The
 * ReasoningRow stamps its row id on every text growth; the answer row polls
 * this map and holds its reveal until the last growth is older than
 * REASONING_SETTLE_MS. Module scope (not React state) keeps the polling
 * free of re-render churn and lets both rows share it without prop drilling.
 */
const lastGrowthByReasoningId = new Map<string, number>();
const revealByReasoningId = new Map<
  string,
  { revealedLen: number; fullLen: number }
>();
/** Reasoning rows whose segment was definitively closed by a tool/clarify
 *  boundary — no more deltas will merge into them, so the answer gate must
 *  NOT wait the full [[REASONING_SETTLE_MS]] stall for them (a quick
 *  thought→answer→tool succession otherwise hides the answer behind the gate
 *  for the whole settle window). Cleared by markReasoningGrowth if the row
 *  genuinely resumes (alternating-tag streams). */
const settledReasoningIds = new Set<string>();

export const REASONING_SETTLE_MS = 1200;

export function markReasoningGrowth(
  reasoningId: string | undefined,
  at = Date.now(),
): void {
  if (!reasoningId) return;
  lastGrowthByReasoningId.set(reasoningId, at);
  // Resumed growth → the row is not settled anymore (its segment reopened).
  settledReasoningIds.delete(reasoningId);
}

/** Mark a reasoning row's segment as definitively closed (a tool/clarify
 *  boundary landed after it) so the answer gate treats it as immediately
 *  settled — bypassing the [[REASONING_SETTLE_MS]] stall wait. The typewriter
 *  reveal check ([[reasoningRevealComplete]]) still applies, so the answer
 *  never reveals before the thought has fully typed. */
export function markReasoningSettled(reasoningId: string | undefined): void {
  if (!reasoningId) return;
  settledReasoningIds.add(reasoningId);
}

/** Milliseconds since the reasoning row last grew; MAX when unknown/absent/
 *  settled, so a row with no reasoning (or a fully settled one) is immediately
 *  ready. */
export function reasoningStalledMs(
  reasoningId: string | undefined,
  now = Date.now(),
): number {
  if (!reasoningId) return Number.MAX_SAFE_INTEGER;
  if (settledReasoningIds.has(reasoningId)) return Number.MAX_SAFE_INTEGER;
  const last = lastGrowthByReasoningId.get(reasoningId);
  if (last === undefined) return Number.MAX_SAFE_INTEGER;
  return now - last;
}

/** Report the reasoning row's typewriter progress (called from its render
 *  prop on every reveal tick). Idempotent module-scope write. */
export function markReasoningReveal(
  reasoningId: string | undefined,
  revealedLen: number,
  fullLen: number,
): void {
  if (!reasoningId) return;
  const prev = revealByReasoningId.get(reasoningId);
  if (prev && prev.revealedLen === revealedLen && prev.fullLen === fullLen) {
    return;
  }
  revealByReasoningId.set(reasoningId, { revealedLen, fullLen });
}

/** True when the thought's typewriter has revealed its FULL text — the
 *  answer reveal must not start while the thought is still animating, even
 *  if its deltas stopped (a fast stream leaves a typing backlog). A settled
 *  row (hard boundary landed: tool / clarify / message.complete) is treated
 *  as instantly complete — its text is final and only the cosmetic typewriter
 *  is still catching up, which must not keep the answer hidden behind the gate. */
export function reasoningRevealComplete(
  reasoningId: string | undefined,
): boolean {
  if (!reasoningId) return true;
  if (settledReasoningIds.has(reasoningId)) return true;
  const reveal = revealByReasoningId.get(reasoningId);
  return reveal !== undefined && reveal.revealedLen >= reveal.fullLen;
}
