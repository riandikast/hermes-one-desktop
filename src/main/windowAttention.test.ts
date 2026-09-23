// The attention IPC must never flash a window the user is already looking at,
// and must always be able to STOP a flash (so an answered card settles down).
import { describe, expect, it, vi } from "vitest";

/** Mirrors the handler body in `src/main/ipc/register.ts` ("window:attention"). */
function handleAttention(
  win: { isFocused: () => boolean; flashFrame: (on: boolean) => void } | null,
  on: unknown,
): void {
  if (!win) return;
  if (on === true) {
    if (!win.isFocused()) win.flashFrame(true);
  } else {
    win.flashFrame(false);
  }
}

describe("window:attention handler", () => {
  it("flashes an unfocused window", () => {
    const win = { isFocused: () => false, flashFrame: vi.fn() };
    handleAttention(win, true);
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it("does NOT flash a focused window", () => {
    const win = { isFocused: () => true, flashFrame: vi.fn() };
    handleAttention(win, true);
    expect(win.flashFrame).not.toHaveBeenCalled();
  });

  it("stops the flash regardless of focus", () => {
    const win = { isFocused: () => true, flashFrame: vi.fn() };
    handleAttention(win, false);
    expect(win.flashFrame).toHaveBeenCalledWith(false);
  });

  it("is a no-op without a window", () => {
    expect(() => handleAttention(null, true)).not.toThrow();
  });

  it("treats a non-boolean payload as 'stop'", () => {
    const win = { isFocused: () => false, flashFrame: vi.fn() };
    handleAttention(win, "yes");
    expect(win.flashFrame).toHaveBeenCalledWith(false);
  });
});
