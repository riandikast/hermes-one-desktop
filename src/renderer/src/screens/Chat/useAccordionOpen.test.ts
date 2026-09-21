// @vitest-environment jsdom
//
// The accordion hook exists because a CSS transition needs a PAINTED "from"
// frame. These pin down that sequencing: the first render must be collapsed
// when animating in, and the flip must happen across two frames (one rAF is
// not enough — React's commit and the browser's first paint can share a frame).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccordionOpen } from "./useAccordionOpen";

/** Drive requestAnimationFrame manually so frames can be stepped one at a time. */
function installManualRaf(): { flush: (frames?: number) => void } {
  let queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    /* the hook cancels by id; stepping manually needs no removal */
  });
  return {
    flush: (frames = 1) => {
      for (let i = 0; i < frames; i += 1) {
        const current = queue;
        queue = [];
        act(() => {
          current.forEach((cb) => cb(performance.now()));
        });
      }
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAccordionOpen", () => {
  it("starts COLLAPSED even when the target is already open", () => {
    // The whole point: opening at mount must not paint at full height first,
    // otherwise the browser has no starting value to transition from.
    installManualRaf();
    const { result } = renderHook(() => useAccordionOpen(true, true));
    expect(result.current).toBe(false);
  });

  it("opens only after TWO frames", () => {
    const raf = installManualRaf();
    const { result } = renderHook(() => useAccordionOpen(true, true));

    raf.flush(1);
    // One frame is not enough — still collapsed.
    expect(result.current).toBe(false);

    raf.flush(1);
    expect(result.current).toBe(true);
  });

  it("starts open (no animation) when animation is disabled", () => {
    installManualRaf();
    const { result } = renderHook(() => useAccordionOpen(true, false));
    expect(result.current).toBe(true);
  });

  it("stays collapsed when the target is closed", () => {
    const raf = installManualRaf();
    const { result } = renderHook(() => useAccordionOpen(false, true));
    raf.flush(3);
    expect(result.current).toBe(false);
  });

  it("closes immediately without waiting for frames", () => {
    // A close transition needs no priming: the open state is already painted,
    // so the browser has its starting value and can interpolate right away.
    const raf = installManualRaf();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useAccordionOpen(open, true),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    raf.flush(2);
    expect(result.current).toBe(true);

    rerender({ open: false });
    expect(result.current).toBe(false);
  });

  it("opens on a later toggle, not just at mount", () => {
    const raf = installManualRaf();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useAccordionOpen(open, true),
      { initialProps: { open: false } },
    );

    expect(result.current).toBe(false);
    rerender({ open: true });
    // Still collapsed on the frame the toggle happened.
    expect(result.current).toBe(false);
    raf.flush(2);
    expect(result.current).toBe(true);
  });

  it("cancels a pending open when closed again mid-flight", () => {
    // Guards a race: toggling open then closed within one frame must not
    // leave the panel stuck open.
    const raf = installManualRaf();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useAccordionOpen(open, true),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    rerender({ open: false });
    raf.flush(3);

    expect(result.current).toBe(false);
  });
});
