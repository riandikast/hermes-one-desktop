import { useEffect, useState } from "react";

/**
 * Drives the accordion open/close state so the CSS transition actually RUNS.
 *
 * The bug this solves: a `grid-template-rows: 0fr -> 1fr` transition only
 * animates if the element is first PAINTED in the collapsed state. When the
 * preference is on at mount, React renders the wrapper already carrying
 * `--open`, the browser paints `1fr` as the initial value, and there is no
 * "from" frame — so the content appears instantly ("spawns") instead of
 * expanding.
 *
 * Fix: keep the initial render collapsed, then flip to open across two frames
 * (a double rAF, so the collapsed state is committed and painted first).
 * A single rAF is not enough — React's commit and the browser's first paint
 * can land in the same frame, and the transition is then skipped again.
 *
 * Returns the value to render NOW, which is deliberately `false` on the very
 * first pass even when the target is open.
 */
export function useAccordionOpen(targetOpen: boolean, animate: boolean): boolean {
  // First render is always collapsed when we intend to animate in.
  const [rendered, setRendered] = useState(() => targetOpen && !animate);

  useEffect(() => {
    if (rendered === targetOpen) return;

    if (!targetOpen) {
      // Closing: one frame is enough, the open state is already painted.
      setRendered(false);
      return;
    }

    if (!animate) {
      setRendered(true);
      return;
    }

    let frame1 = 0;
    let frame2 = 0;
    frame1 = requestAnimationFrame(() => {
      // Second frame guarantees the collapsed state has been painted, so the
      // browser has a real starting value to interpolate from.
      frame2 = requestAnimationFrame(() => setRendered(true));
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [targetOpen, animate, rendered]);

  return rendered;
}
