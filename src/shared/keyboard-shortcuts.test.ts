// @vitest-environment node
import { expect, it } from "vitest";
import { SHORTCUTS, bindingsFor, matchesBinding, validateShortcutOverrides } from "./keyboard-shortcuts";

it("validates every shipped binding and preserves explicit unassignment", () => {
  for (const shortcut of SHORTCUTS) {
    for (const platform of ["win32", "darwin"]) {
      expect(validateShortcutOverrides({ [shortcut.id]: [...bindingsFor(shortcut.id, {}, platform)] })).toBeUndefined();
    }
  }
  expect(bindingsFor("newChat", { newChat: [] })).toEqual([]);
  expect(bindingsFor("fullscreen", {}, "darwin")).toEqual(["Ctrl+Meta+F"]);
});
it("matches exact modifiers, platform primary keys, numpad and IME", () => {
  expect(matchesBinding({ key: "n", ctrlKey: true }, "Mod+N")).toBe(true);
  expect(matchesBinding({ key: "n", metaKey: true }, "Mod+N", "darwin")).toBe(true);
  expect(matchesBinding({ key: "n", ctrlKey: true, shiftKey: true }, "Mod+N")).toBe(false);
  expect(matchesBinding({ key: "Enter", shiftKey: true }, "Enter")).toBe(false);
  expect(matchesBinding({ key: "Enter", isComposing: true }, "Enter")).toBe(false);
  expect(matchesBinding({ key: "Enter", keyCode: 229 }, "Enter")).toBe(false);
  expect(matchesBinding({ key: "+", ctrlKey: true, shiftKey: true }, "Mod+Plus")).toBe(true);
  expect(matchesBinding({ key: "+", code: "NumpadAdd", ctrlKey: true }, "Mod+Plus")).toBe(true);
  expect(matchesBinding({ key: "End", code: "Numpad1", ctrlKey: true }, "Mod+1")).toBe(true);
  expect(matchesBinding({ key: "Tab", ctrlKey: true, shiftKey: true }, "Ctrl+Shift+Tab")).toBe(true);
});
it("rejects malformed preference payloads at the IPC boundary", () => {
  for (const value of [null, [], { unknown: [] }, { newChat: "Ctrl+N" }, { newChat: ["Ctrl+Ctrl+N"] }, { newChat: ["Ctrl+"] }, { newChat: ["Bogus+N"] }, { newChat: Array(9).fill("Ctrl+N") }]) {
    expect(validateShortcutOverrides(value)).toEqual(expect.any(String));
  }
  expect(validateShortcutOverrides({ sendMessage: ["Mod+Enter"], closeTab: [] })).toBeUndefined();
});
