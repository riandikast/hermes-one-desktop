// @vitest-environment jsdom
//
// refit() on TerminalDock.
//
// xterm measures ~zero while its container is `display: none`, so after the
// On-Finish dialog is closed and reopened the terminal would keep a stale
// geometry and wrap output at the wrong column count. `refit()` re-measures and
// pushes the result to the pty. These assert it fits and resizes, and that it
// is a no-op when there is no active session (so an early call cannot throw).

import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDock, type TerminalDockHandle } from "./TerminalDock";

// xterm needs a real DOM canvas; stub the pieces the dock touches so the
// component mounts headlessly. The fit addon's fit() is what we assert on.
const fitCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open(): void {}
    write(): void {}
    dispose(): void {}
    loadAddon(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {
      fitCalls.count += 1;
    }
  },
}));

let consResize: unknown[] = [];
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  fitCalls.count = 0;
  consResize = [];
  rafQueue = [];
  // Collect rAF callbacks so a test can flush them deterministically.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  // The dock observes its container to keep the pty in sync; jsdom has no
  // ResizeObserver, so stub one that simply registers observers.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    terminalWrite: vi.fn(),
    terminalKill: vi.fn(),
    terminalResize: vi.fn((payload: unknown) => {
      consResize.push(payload);
    }),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
  };
});

function renderDock(): {
  ref: React.RefObject<TerminalDockHandle | null>;
  container: HTMLElement;
} {
  const ref = createRef<TerminalDockHandle>();
  const { container } = render(
    <TerminalDock
      ref={ref}
      onNewSession={() => undefined}
      onResizeStart={() => undefined}
      onResizeMove={() => undefined}
      onResizeEnd={() => undefined}
    />,
  );
  return { ref, container };
}

describe("TerminalDock.refit", () => {
  it("is exposed on the handle", () => {
    const { ref } = renderDock();
    expect(typeof ref.current?.refit).toBe("function");
  });

  it("does not throw when there is no active session", () => {
    const { ref } = renderDock();
    expect(() => ref.current?.refit()).not.toThrow();
  });

  it("pushes the pty geometry on refit after being hidden", () => {
    const { ref } = renderDock();
    act(() => {
      ref.current?.attachSession("term-1", "On-Finish");
    });
    // Let attachSession's own fit settle, then clear the record so the next
    // resize can only have come from refit().
    act(() => {
      rafQueue.forEach((cb) => cb(performance.now()));
      rafQueue = [];
    });
    consResize.length = 0;
    fitCalls.count = 0;

    act(() => {
      ref.current?.refit();
    });
    act(() => {
      rafQueue.forEach((cb) => cb(performance.now()));
      rafQueue = [];
    });

    // refit must BOTH re-measure and tell the pty the new column count; a fit
    // without the resize leaves the shell wrapping at the old width.
    expect(fitCalls.count).toBeGreaterThan(0);
    expect(consResize.length).toBeGreaterThan(0);
    expect(consResize.at(-1)).toMatchObject({ id: "term-1" });
  });

  it("accepts an omitted dockHeight so CSS can size the dock", () => {
    // The dialog relies on this: an inline height would override its layout.
    const { container } = renderDock();
    const dock = container.querySelector<HTMLElement>(".terminal-dock");
    expect(dock?.style.height).toBe("");
  });
});
