import { useEffect, useRef, useState } from "react";
import {
  REASONING_SETTLE_MS,
  reasoningRevealComplete,
  reasoningStalledMs,
} from "./reasoningStall";

/**
 * True when the referenced reasoning row is done animating: no deltas for at
 * least [[reasoningStall#REASONING_SETTLE_MS]] AND the typewriter has caught up
 * to the full text ([[reasoningStall#reasoningRevealComplete]]). The answer
 * bubble and tool groups gate their appearance on this so a turn reads
 * "full thought -> tools -> response" instead of overlapping — the thought
 * finishes typing before anything later in the turn appears.
 *
 * Safety net: a thought that has been quiet for [[REASONING_FORCE_REVEAL_MS]]
 * (5s) is treated as done even if its typewriter never reported completion —
 * the reasoning row may have been dropped by the end-of-stream reconciliation
 * mid-reveal, or the turn's `message.complete` (which sets the settled marker
 * AND flips `isLoading` false) may never arrive. Without this the answer stays
 * hidden forever, and nothing but a full app restart clears the stale module
 * state — the "last response only appears after restarting the app" report.
 */
const REASONING_FORCE_REVEAL_MS = 5000;

function isReasoningDone(reasoningId: string | undefined): boolean {
  if (!reasoningId) return true;
  const stalledMs = reasoningStalledMs(reasoningId);
  if (
    stalledMs >= REASONING_SETTLE_MS &&
    reasoningRevealComplete(reasoningId)
  ) {
    return true;
  }
  return stalledMs >= REASONING_FORCE_REVEAL_MS;
}

/**
 * Hide a row until the reasoning row it depends on has fully typed out.
 *
 * `waitForReasoningId` is the most recent reasoning row that PRECEDES this row
 * in the turn (per-segment gating: a tool between two thoughts gates on the
 * first, the answer gates on the last). The gate opens once and never
 * re-closes — interleaved thinking arriving after the row has moved on must
 * not re-hide already-shown rows.
 *
 * When the turn ends (`isLoading` false) the gate opens immediately: the
 * thought is no longer growing, and the answer must never be stuck hidden
 * after the turn completes (e.g. the thought row was dropped by the
 * end-of-stream reconciliation, or its typewriter never caught up — both
 * leave `reasoningRevealComplete` false forever). During streaming the gate
 * still waits for the thought to settle so tools don't appear mid-thought.
 */
export function useReasoningGate({
  waitForReasoningId,
  hasContent,
  isLoading,
}: {
  waitForReasoningId?: string;
  hasContent: boolean;
  isLoading: boolean;
}): { waiting: boolean } {
  const revealedOnceRef = useRef(false);
  const [waiting, setWaiting] = useState(() =>
    Boolean(
      hasContent &&
      waitForReasoningId &&
      !reasoningRevealComplete(waitForReasoningId),
    ),
  );

  useEffect(() => {
    if (revealedOnceRef.current) return;
    if (!hasContent) return;
    // Turn ended → open immediately (safety net: the thought row may have
    // been dropped by reconciliation, leaving reasoningRevealComplete false
    // forever; without this bypass the answer would stay hidden).
    if (
      !isLoading ||
      !waitForReasoningId ||
      isReasoningDone(waitForReasoningId)
    ) {
      revealedOnceRef.current = true;
      setWaiting(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (): void => {
      if (cancelled) return;
      if (isReasoningDone(waitForReasoningId)) {
        revealedOnceRef.current = true;
        setWaiting(false);
        return;
      }
      setWaiting(true);
      timer = setTimeout(check, 250);
    };
    check();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [waitForReasoningId, hasContent, isLoading]);

  // Smoking-gun diagnostic: a row that is STILL hidden while the turn has
  // ended (isLoading false) can only be hidden by a bug — the !isLoading
  // bypass above must open it. If this fires, dump the gate's inputs so we
  // can see exactly which condition is stuck.
  useEffect(() => {
    if (isLoading || !waiting) return;
    console.info("[gate-diag] row hidden after turn ended", {
      waitForReasoningId,
      hasContent,
      stalledMs: reasoningStalledMs(waitForReasoningId),
      revealComplete: reasoningRevealComplete(waitForReasoningId),
      settleMs: REASONING_SETTLE_MS,
    });
  }, [isLoading, waiting, waitForReasoningId, hasContent]);

  return { waiting };
}
