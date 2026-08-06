import { useEffect, useRef, useState } from "react";
import {
  REASONING_SETTLE_MS,
  reasoningRevealComplete,
  reasoningStalledMs,
} from "./reasoningStall";

/**
 * True when the referenced reasoning row has finished GROWING — no deltas for
 * at least [[reasoningStall#REASONING_SETTLE_MS]]. The typewriter's reveal
 * progress is deliberately NOT checked here: the cosmetic animation catching up
 * must not keep the answer hidden behind the gate (a long thought's typewriter
 * can lag seconds behind its final text, which made the answer "stuck" until
 * the typewriter finished — or forever when the completion event was lost and
 * `isLoading` never flipped). The thought keeps typing cosmetically above
 * while the answer reveals below. A settled row (tool / clarify /
 * message.complete boundary) short-circuits this via [[reasoningStalledMs]]
 * returning MAX.
 */
function isReasoningDone(reasoningId: string | undefined): boolean {
  if (!reasoningId) return true;
  return reasoningStalledMs(reasoningId) >= REASONING_SETTLE_MS;
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

  return { waiting };
}
