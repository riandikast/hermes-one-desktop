import { memo, useEffect, useRef, useState } from "react";

/**
 * Typewriter-style text reveal. When `active` is true the content is
 * revealed character-by-character at the configured cadence (chars per
 * second). When `active` flips to false the full text is shown instantly.
 *
 * Implementation notes:
 *  - We use `setInterval` (NOT `requestAnimationFrame`) at a fixed cadence
 *    so the reveal advances in discrete steps rather than per-frame. This
 *    gives a clear, readable typing feel — at 60fps the eye can barely
 *    track per-frame changes and the animation looks glitchy.
 *  - When `text` grows (e.g. new tokens arrive) we resume from the current
 *    `revealed` count, so the animation never restarts or jumps backwards.
 *  - When `active` flips off the full text is shown immediately.
 */
export const TypeAnimation = memo(function TypeAnimation({
  text,
  active,
  charsPerSecond = 40,
  className,
}: {
  text: string;
  active: boolean;
  charsPerSecond?: number;
  className?: string;
}): React.JSX.Element {
  // Number of characters currently visible.
  const [revealed, setRevealed] = useState(active ? 0 : text.length);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTicksRef = useRef(0);

  useEffect(() => {
    elapsedTicksRef.current = 0;
    // Stop any prior timer.
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!active) {
      // Skip animation entirely — show full text now.
      setRevealed(text.length);
      return;
    }

    // Pick the cadence. Interval >= 50ms so the eye can track each step
    // comfortably; lower bound keeps very high cps from skipping chars.
    const stepMs = Math.max(50, Math.round(1000 / charsPerSecond));
    // Cap the TOTAL reveal at ~15s: a large chunk that arrived all at once
    // (e.g. a thinking summary delivered as a single blob at completion)
    // still types out instead of dumping instantly — without taking minutes.
    const maxTicks = Math.max(1, Math.round(15_000 / stepMs));

    intervalRef.current = setInterval(() => {
      elapsedTicksRef.current += 1;
      setRevealed((prev) => {
        if (prev >= text.length) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return prev;
        }
        // Reveal at least one character per tick. When a large chunk arrived
        // at once (pending >> ticks left), reveal a proportional chunk so the
        // whole thing finishes within the 15s cap while small streamed
        // deltas still tick one char at a time.
        const pending = text.length - prev;
        const ticksLeft = Math.max(1, maxTicks - elapsedTicksRef.current);
        const chunk = Math.max(1, Math.ceil(pending / ticksLeft));
        return prev + chunk;
      });
    }, stepMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, text, charsPerSecond]);

  const showCaret = active && revealed < text.length;
  // When inactive the full text shows immediately (no caret).
  const visible = active ? text.slice(0, revealed) : text;

  return (
    <span className={className}>
      {visible}
      {showCaret ? (
        <span className="type-animation-caret" aria-hidden="true">
          ▍
        </span>
      ) : null}
    </span>
  );
});
