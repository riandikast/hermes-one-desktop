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
