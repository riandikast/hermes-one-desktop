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
  maxDurationMs,
  className,
  children,
  showCaret = true,
  startFrom = 0,
  maxCharsPerTick,
}: {
  text: string;
  active: boolean;
  charsPerSecond?: number;
  /** Hard cap on the reveal's wall-clock duration (ms). The character cadence
   *  above stays the floor for short text; long text reveals as much per tick
   *  as needed to be fully on screen within this budget — the chat rows use it
   *  so long accumulated answers appear almost instantly instead of typing
   *  out at the char rate. */
  maxDurationMs?: number;
  className?: string;
  /** Render-prop mode: when provided, receives the currently visible text
   *  and renders it however the caller needs (e.g. through a markdown
   *  renderer) instead of the raw-text span. */
  children?: (visible: string) => React.ReactNode;
  /** Show the blinking caret while the reveal is mid-flight. The answer
   *  bubble disables it: when the reveal outpaces the token stream it keeps
   *  catching up between chunks, so the caret flickers on/off at stream
   *  cadence — a visible blink on the text. */
  showCaret?: boolean;
  /** Reveal start offset for a freshly mounted instance. Defaults to 0
   *  (type from the beginning); the answer bubble passes the snap point so
   *  a re-growth after the reveal finished types only the new text. */
  startFrom?: number;
  /** Hard ceiling on characters revealed per tick. The wall-clock budget
   *  (`maxDurationMs`) scales the per-tick reveal so long text finishes fast,
   *  which for very long text can mean 100+ chars in one 50ms tick — giant
   *  jumps that read as a blink. The ceiling keeps every tick a readable
   *  burst; the duration budget then simply takes longer to empty. Absent
   *  (default) means no ceiling — the budget scales freely as before. */
  maxCharsPerTick?: number;
}): React.JSX.Element {
  // Number of characters currently visible.
  const [revealed, setRevealed] = useState(active ? startFrom : text.length);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
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
    // Characters per tick at the configured cps. Without this floor the
    // 50ms interval limit caps the reveal at 20 chars/s — several times
    // SLOWER than a typical streamed token rate (~50 chars/s), so the
    // reveal permanently lags the stream and thinking still looks
    // unfinished when the answer bubble starts.
    const perTick = Math.max(1, Math.round(charsPerSecond / (1000 / stepMs)));
    // Duration cap: reveal enough per tick to put the whole text on screen
    // within `maxDurationMs`. The cadence floor above still dominates for
    // short text; the cap makes arbitrarily long text appear almost
    // instantly (recomputed on every tick of a growing text via the effect
    // re-run below).
    const durationPerTick =
      maxDurationMs !== undefined && maxDurationMs > 0
        ? Math.ceil((text.length / maxDurationMs) * stepMs)
        : 0;
    // Ceiling on the duration-driven reveal: for very long text the budget
    // can demand 100+ chars/tick, strobe in giant frames. Bound each tick to
    // a readable burst; the budget then just takes longer to empty. The
    // cadence floor below still dominates for short text.
    const revealPerTick = Math.max(
      perTick,
      maxCharsPerTick !== undefined && maxCharsPerTick > 0
        ? Math.min(durationPerTick, maxCharsPerTick)
        : durationPerTick,
    );

    intervalRef.current = setInterval(() => {
      setRevealed((prev) => {
        if (prev >= text.length) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return prev;
        }
        // Reveal `revealPerTick` characters per tick; a growing text keeps
        // advancing (never restarts or jumps backwards).
        return Math.min(text.length, prev + revealPerTick);
      });
    }, stepMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, text, charsPerSecond, maxDurationMs, maxCharsPerTick]);

  const showCaretEl = showCaret && active && revealed < text.length;
  // When inactive the full text shows immediately (no caret).
  const visible = active ? text.slice(0, revealed) : text;

  return (
    <span className={className}>
      {children ? children(visible) : visible}
      {showCaretEl ? (
        <span className="type-animation-caret" aria-hidden="true">
          ▍
        </span>
      ) : null}
    </span>
  );
});
