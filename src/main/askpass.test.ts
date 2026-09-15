import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `showApprovalDialog` is the themed approval modal (see gatewayPrompt.ts).
 * These tests pin its PLACEMENT contract: the native dialog it replaced
 * centered itself on the parent automatically, while a bare BrowserWindow is
 * placed at an OS-cascade offset — so the modal must center itself over the
 * parent before its first paint, and never flash at the cascaded position.
 */

// askpass.ts reads __dirname when building the preload path; the Electron
// main bundle is CJS but vitest runs ESM, so provide a stub for the lookup.
(globalThis as { __dirname?: string }).__dirname ??= process.cwd();

const mockState = {
  created: [] as Array<{
    options: Record<string, unknown>;
    handlers: Record<string, () => void>;
    positionCalls: Array<[number, number]>;
    actions: string[];
    centered: boolean;
  }>,
};

vi.mock("electron", () => ({
  BrowserWindow: class {
    options: Record<string, unknown>;
    handlers: Record<string, () => void> = {};
    positionCalls: Array<[number, number]> = [];
    actions: string[] = [];
    centered = false;
    webContents = {
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mockState.created.push(this);
    }

    getBounds() {
      return {
        x: 0,
        y: 0,
        width: this.options.width as number,
        height: this.options.height as number,
      };
    }

    setPosition(x: number, y: number) {
      this.positionCalls.push([x, y]);
      this.actions.push("setPosition");
    }

    center() {
      this.centered = true;
      this.actions.push("center");
    }

    show() {
      this.actions.push("show");
    }

    isDestroyed() {
      return false;
    }

    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }

    once(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }

    close() {
      /* resolved via the "closed" handler */
    }

    loadURL() {
      return undefined;
    }
  },
  ipcMain: {
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

import { showApprovalDialog } from "./askpass";

function fakeParent(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    getBounds: () => bounds,
    isDestroyed: () => false,
  } as never;
}

beforeEach(() => {
  mockState.created.length = 0;
});

describe("showApprovalDialog placement", () => {
  it("centers over the parent before showing, and closes to deny", async () => {
    const parent = fakeParent({ x: 100, y: 200, width: 1000, height: 600 });
    const pending = showApprovalDialog(parent, {
      choices: ["once", "deny"],
      command: "echo hi",
      description: "test",
      labels: {},
    });

    const win = mockState.created[0];
    win.handlers.closed();
    await expect(pending).resolves.toBe("deny");

    // Hidden at creation so it never paints at the OS-cascade position.
    expect(win.options.show).toBe(false);
    // 520x360 centered over (100,200,1000,600) lands at (340, 320).
    expect(win.positionCalls).toEqual([[340, 320]]);
    expect(win.centered).toBe(false);
    // Positioning happens before the window becomes visible.
    expect(win.actions.indexOf("setPosition")).toBeLessThan(
      win.actions.indexOf("show"),
    );
  });

  it("falls back to screen centering when there is no parent", async () => {
    const pending = showApprovalDialog(null, {
      choices: ["once"],
      command: "",
      description: "d",
      labels: {},
    });

    const win = mockState.created[0];
    win.handlers.closed();
    await expect(pending).resolves.toBe("deny");

    expect(win.centered).toBe(true);
    expect(win.positionCalls).toEqual([]);
    expect(win.actions.indexOf("center")).toBeLessThan(
      win.actions.indexOf("show"),
    );
  });
});
