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
 */
function isReasoningDone(reasoningId: string | undefined): boolean {
  if (!reasoningId) return true;
  return (
    reasoningStalledMs(reasoningId) >= REASONING_SETTLE_MS &&
    reasoningRevealComplete(reasoningId)
  );
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
 * `waiting` is initialised synchronously from the module-scope reveal map so a
 * row that mounts after its thought already finished (history load, or a fast
 * stream) doesn't flash hidden for a frame before the effect opens it.
 */
export function useReasoningGate({
  waitForReasoningId,
  hasContent,
}: {
  waitForReasoningId?: string;
  hasContent: boolean;
}): { waiting: boolean } {
  const revealedOnceRef = useRef(false);
  const [waiting, setWaiting] = useState(
    () =>
      Boolean(
        hasContent && waitForReasoningId && !reasoningRevealComplete(waitForReasoningId),
      ),
  );

  useEffect(() => {
    if (revealedOnceRef.current) return;
    if (!hasContent) return;
    if (!waitForReasoningId || isReasoningDone(waitForReasoningId)) {
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
  }, [waitForReasoningId, hasContent]);

  return { waiting };
}