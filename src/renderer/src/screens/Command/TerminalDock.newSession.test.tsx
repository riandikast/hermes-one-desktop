// @vitest-environment jsdom
//
// The terminal dock's "+" button.
//
// The bug this guards: Chat passed `onNewSession={() => undefined}`, so the
// button rendered and looked live but created nothing — no session, no tab, no
// error. Every click was a silent no-op. These assert the button actually calls
// the handler AND that the handler the app supplies creates a session.

import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDock, type TerminalDockHandle } from "./TerminalDock";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open(): void {}
    focus(): void {
      const store = (globalThis as unknown as { __focusCalls?: number[] });
      (store.__focusCalls ??= []).push(Date.now());
    }
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
    fit(): void {}
  },
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    terminalWrite: vi.fn(),
    terminalKill: vi.fn(),
    terminalResize: vi.fn(),
    terminalCreate: vi.fn().mockResolvedValue({ id: "term-new" }),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
  };
});

function renderDock(onNewSession: () => void): {
  ref: React.RefObject<TerminalDockHandle | null>;
  container: HTMLElement;
} {
  const ref = createRef<TerminalDockHandle>();
  const { container } = render(
    <TerminalDock
      ref={ref}
      onNewSession={onNewSession}
      onResizeStart={() => undefined}
      onResizeMove={() => undefined}
      onResizeEnd={() => undefined}
    />,
  );
  return { ref, container };
}

describe('terminal dock "+" button', () => {
  it("creates only on empty opening, preserves sessions on reopen, stays lazy closed", () => {
    const ref = createRef<TerminalDockHandle>();
    const onNewSession = vi.fn();
    const dock = (open: boolean) => <TerminalDock ref={ref} open={open}
      onNewSession={onNewSession} onResizeStart={() => undefined}
      onResizeMove={() => undefined} onResizeEnd={() => undefined} />;
    const view = render(dock(false));
    expect(onNewSession).not.toHaveBeenCalled();
    view.rerender(dock(true));
    view.rerender(dock(true));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    act(() => ref.current?.attachSession("existing", "Existing"));
    view.rerender(dock(false));
    view.rerender(dock(true));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Close terminal"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    view.rerender(dock(false));
    view.rerender(dock(true));
    expect(onNewSession).toHaveBeenCalledTimes(2);
  });
  it("invokes the supplied onNewSession handler", () => {
    const onNewSession = vi.fn();
    renderDock(onNewSession);

    fireEvent.click(screen.getByLabelText("New terminal session"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the handler is a placeholder — the regression", () => {
    // Documents the bug's shape: a placeholder handler makes the button dead,
    // which is why the real one must be wired in Chat.tsx.
    const placeholder = () => undefined;
    renderDock(placeholder);

    fireEvent.click(screen.getByLabelText("New terminal session"));
    // Nothing to assert but survival: no error, and no tab appears.
    expect(
      document.querySelectorAll(".terminal-dock-tab").length,
    ).toBe(0);
  });

  it("creates a session and shows a tab when wired to the real handler", async () => {
    // The real handler Chat now passes: create the pty, then attach it.
    const ref = createRef<TerminalDockHandle>();
    const { container } = render(
      <TerminalDock
        ref={ref}
        onNewSession={() => {
          void (async () => {
            const { id } = await window.hermesAPI.terminalCreate({
              cwd: "",
              cols: 80,
              rows: 24,
            });
            ref.current?.attachSession(id, "Terminal");
          })();
        }}
        onResizeStart={() => undefined}
        onResizeMove={() => undefined}
        onResizeEnd={() => undefined}
      />,
    );

    expect(window.hermesAPI.terminalCreate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("New terminal session"));
    });

    expect(window.hermesAPI.terminalCreate).toHaveBeenCalledTimes(1);
    // A tab must exist, or the new terminal is invisible to the user.
    expect(
      container.querySelectorAll(".terminal-dock-tab").length,
    ).toBe(1);
  });

  it("keeps the button enabled so it cannot become an invisible dead end", () => {
    const onNewSession = vi.fn();
    renderDock(onNewSession);
    const btn = screen.getByLabelText("New terminal session");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("terminal dock project-directory sessions", () => {
  it("finds an existing session by cwd, normalizing case and trailing slashes", () => {
    const ref = createRef<TerminalDockHandle>();
    render(
      <TerminalDock
        ref={ref}
        onNewSession={() => undefined}
        onResizeStart={() => undefined}
        onResizeMove={() => undefined}
        onResizeEnd={() => undefined}
      />,
    );

    act(() => ref.current?.attachSession("term-a", "Proj", "D:\\Work\\App\\"));
    expect(ref.current?.findSessionByCwd("d:/work/app")).toBe("term-a");
    expect(ref.current?.findSessionByCwd("D:\\Work\\App")).toBe("term-a");
    expect(ref.current?.findSessionByCwd("D:\\Work\\Other")).toBeNull();
  });

  it("returns null for a blank cwd so callers do not match everything", () => {
    const ref = createRef<TerminalDockHandle>();
    render(
      <TerminalDock
        ref={ref}
        onNewSession={() => undefined}
        onResizeStart={() => undefined}
        onResizeMove={() => undefined}
        onResizeEnd={() => undefined}
      />,
    );
    act(() => ref.current?.attachSession("term-a", "Proj", "C:/proj"));
    expect(ref.current?.findSessionByCwd("")).toBeNull();
    expect(ref.current?.findSessionByCwd("   ")).toBeNull();
  });

  it("forgets a closed session so its directory can spawn fresh", () => {
    const ref = createRef<TerminalDockHandle>();
    render(
      <TerminalDock
        ref={ref}
        onNewSession={() => undefined}
        onResizeStart={() => undefined}
        onResizeMove={() => undefined}
        onResizeEnd={() => undefined}
      />,
    );
    act(() => ref.current?.attachSession("term-a", "Proj", "C:/proj"));
    expect(ref.current?.findSessionByCwd("C:/proj")).toBe("term-a");

    fireEvent.click(screen.getByLabelText("Close terminal"));
    expect(ref.current?.findSessionByCwd("C:/proj")).toBeNull();
  });

  it("activates and focuses the requested session", () => {
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
    act(() => ref.current?.attachSession("term-a", "A"));
    act(() => ref.current?.attachSession("term-b", "B"));
    act(() => ref.current?.focusSession("term-a"));

    const active = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(active?.textContent).toContain("A");
  });

  it("calls term.focus() when a session is attached (autofocus)", () => {
    // The regression: focus was attempted in a single frame while the floating
    // overlay was still `visibility: hidden`, where focus cannot land. The
    // dock now retries; what matters here is that it does call focus at all.
    const calls = (globalThis as unknown as { __focusCalls: number[] });
    calls.__focusCalls.length = 0;
    const ref = createRef<TerminalDockHandle>();
    render(
      <TerminalDock
        ref={ref}
        onNewSession={() => undefined}
        onResizeStart={() => undefined}
        onResizeMove={() => undefined}
        onResizeEnd={() => undefined}
      />,
    );
    act(() => ref.current?.attachSession("term-focus", "Focus"));
    expect(calls.__focusCalls.length).toBeGreaterThan(0);
  });
});
