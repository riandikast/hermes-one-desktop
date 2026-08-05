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
const revealByReasoningId = new Map<string, { revealedLen: number; fullLen: number }>();

export const REASONING_SETTLE_MS = 1200;

export function markReasoningGrowth(
  reasoningId: string | undefined,
  at = Date.now(),
): void {
  if (!reasoningId) return;
  lastGrowthByReasoningId.set(reasoningId, at);
}

/** Milliseconds since the reasoning row last grew; MAX when unknown/absent,
 *  so a row with no reasoning (or a fully settled one) is immediately ready. */
export function reasoningStalledMs(
  reasoningId: string | undefined,
  now = Date.now(),
): number {
  if (!reasoningId) return Number.MAX_SAFE_INTEGER;
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
 *  if its deltas stopped (a fast stream leaves a typing backlog). */
export function reasoningRevealComplete(reasoningId: string | undefined): boolean {
  if (!reasoningId) return true;
  const reveal = revealByReasoningId.get(reasoningId);
  return reveal !== undefined && reveal.revealedLen >= reveal.fullLen;
}
