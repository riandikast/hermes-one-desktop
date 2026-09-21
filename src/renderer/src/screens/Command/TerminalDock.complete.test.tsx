// @vitest-environment jsdom
//
// `cd` completion wired into the terminal dock.
//
// The drop is where the risk is, so this drives the REAL xterm onData handler
// via the mocked Terminal and asserts the dropdown, the Tab cycle, and that
// Enter inserts rather than executing a half-typed path.
//
// It also asserts the load-bearing negative: typing normally must NOT swallow
// the keystroke — the shell still has to receive every character.

import { createRef } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDock, type TerminalDockHandle } from "./TerminalDock";

/** Captured onData callbacks, keyed by the view that registered them. */
let dataHandlers: Map<unknown, (d: string) => void>;
let written: { id: string; data: string }[];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    handlers = new Map<unknown, (d: string) => void>();
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      dataHandlers = new Map();
      void self;
    }
    open(): void {}
    write(): void {}
    dispose(): void {}
    loadAddon(): void {}
    focus(): void {}
    onData(cb: (d: string) => void): { dispose: () => void } {
      dataHandlers.set(this, cb);
      return { dispose: () => dataHandlers.delete(this) };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
  },
}));

beforeEach(() => {
  written = [];
  dataHandlers = new Map();
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
    terminalWrite: vi.fn((p: { id: string; data: string }) => {
      written.push(p);
    }),
    terminalKill: vi.fn(),
    terminalResize: vi.fn(),
    readDirectory: vi.fn().mockResolvedValue([
      { name: "src", isDirectory: true },
      { name: "scripts", isDirectory: true },
      { name: "README.md", isDirectory: false },
    ]),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
  };
});

/** Render the dock and attach one session, returning its onData sender. */
function mount() {
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
  act(() => {
    ref.current?.attachSession("term-1", "Terminal", "/home/me/proj");
  });
  const send = (data: string): void => {
    const cb = [...dataHandlers.values()][0];
    if (!cb) throw new Error("no onData handler registered");
    act(() => cb(data));
  };
  return { container, send, ref };
}

/** Type a string one character at a time, as a user would. */
function type(send: (d: string) => void, text: string): void {
  for (const ch of text) send(ch);
}

describe("cd completion in the terminal dock", () => {
  it("does not open a dropdown for ordinary typing", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    expect(container.querySelector(".terminal-complete")).toBeNull();
  });

  it("forwards every typed character to the pty", () => {
    const { send } = mount();
    type(send, "cd s");
    const text = written.map((w) => w.data).join("");
    expect(text).toBe("cd s");
  });

  it("opens a dropdown of matching directories on Tab", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });

    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );
    const items = [...container.querySelectorAll(".terminal-complete-item")].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(["scripts", "src"]);
  });

  it("does NOT send Tab to the shell when it opens the dropdown", () => {
    const { send } = mount();
    type(send, "cd s");
    const before = written.length;
    act(() => send("\t"));
    // Tab was consumed as a completion request, not forwarded.
    expect(written.length).toBe(before);
  });

  it("does not open a dropdown for a non-cd command", async () => {
    const { container, send } = mount();
    type(send, "echo sr");
    await act(async () => {
      send("\t");
    });
    expect(container.querySelector(".terminal-complete")).toBeNull();
  });

  it("cycles the highlighted entry on repeated Tab", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });
    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );

    const activeIndex = (): number =>
      [...container.querySelectorAll(".terminal-complete-item")].findIndex((el) =>
        el.className.includes("is-active"),
      );
    expect(activeIndex()).toBe(0);
    act(() => send("\t"));
    expect(activeIndex()).toBe(1);
    // Wraps back around rather than sticking at the end.
    act(() => send("\t"));
    expect(activeIndex()).toBe(0);
  });

  it("inserts the highlighted entry on Enter instead of running the line", async () => {
    const { send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });
    await waitFor(() => expect(written.length).toBeGreaterThan(0));

    act(() => send("\r"));

    // The last write must be the Ctrl-U + rebuilt line, never a bare CR that
    // would execute a half-typed `cd sr`.
    const last = written[written.length - 1].data;
    expect(last.startsWith("\u0015")).toBe(true);
    expect(last).toContain("scripts/");
    expect(written.some((w) => w.data === "\r")).toBe(false);
  });

  it("dismisses the dropdown on Escape without reaching the shell", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });
    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );

    const before = written.length;
    act(() => send("\u001b"));
    expect(container.querySelector(".terminal-complete")).toBeNull();
    expect(written.length).toBe(before);
  });

  it("closes the dropdown when typing continues", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });
    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );

    act(() => send("c"));
    expect(container.querySelector(".terminal-complete")).toBeNull();
  });

  it("tracks backspace so the fragment stays accurate", async () => {
    const { container, send } = mount();
    type(send, "cd sc");
    send("\u007f"); // backspace -> "cd s"
    await act(async () => {
      send("\t");
    });
    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );
    const items = [...container.querySelectorAll(".terminal-complete-item")].map(
      (el) => el.textContent,
    );
    // Matching "s" (both dirs) proves the mirrored line tracked the deletion:
    // had backspace been ignored the fragment would be "sc" and only `scripts`
    // would come back.
    expect(items).toEqual(["scripts", "src"]);
  });

  it("resets the tracked line on Enter so a new command starts clean", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    send("\r");
    // New line: nothing to complete.
    await act(async () => {
      send("\t");
    });
    expect(container.querySelector(".terminal-complete")).toBeNull();
  });

  it("inserts via click as well as keyboard", async () => {
    const { container, send } = mount();
    type(send, "cd s");
    await act(async () => {
      send("\t");
    });
    await waitFor(() =>
      expect(container.querySelector(".terminal-complete")).not.toBeNull(),
    );

    const second = container.querySelectorAll(".terminal-complete-item")[1];
    fireEvent.mouseDown(second);

    const last = written[written.length - 1].data;
    expect(last).toContain("src/");
    expect(container.querySelector(".terminal-complete")).toBeNull();
  });
});
