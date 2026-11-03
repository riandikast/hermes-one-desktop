import type { BrowserWindow, Input } from "electron";
import { SHORTCUTS, bindingsFor, matchesBinding, type ShortcutId } from "../shared/keyboard-shortcuts";
import { getKeyboardShortcuts, shortcutRecording } from "./keyboard-shortcut-settings";
import { zoomBy, zoomReset } from "./zoom";

/** Main commands must consume their event before native menu accelerators fire. */
export function handleShortcutInput(win: BrowserWindow, event: { preventDefault(): void }, input: Input): void {
  if (input.type !== "keyDown" || shortcutRecording) return;
  const key = { key: input.key, code: input.code, ctrlKey: input.control, metaKey: input.meta, shiftKey: input.shift, altKey: input.alt, isComposing: input.isComposing };
  const preferences = getKeyboardShortcuts();
  const action = SHORTCUTS.find((item) => item.owner === "main" && bindingsFor(item.id, preferences, process.platform).some((binding) => matchesBinding(key, binding, process.platform)));
  if (!action) return;
  // Native edit accelerators retain the menu role's usual editor integration.
  if (["undo", "redo", "cut", "copy", "paste", "selectAll"].includes(action.id) && !(action.id in preferences)) return;
  event.preventDefault();
  runMainShortcut(win, action.id);
}

export function runMainShortcut(win: BrowserWindow, id: ShortcutId): void {
  switch (id) {
    case "newChat": win.webContents.send("menu-new-chat"); break;
    case "searchSessions": win.webContents.send("menu-search-sessions"); break;
    case "zoomIn": zoomBy(win, 1); break;
    case "zoomOut": zoomBy(win, -1); break;
    case "zoomReset": zoomReset(win); break;
    case "fullscreen": win.setFullScreen(!win.isFullScreen()); break;
    case "minimize": win.minimize(); break;
    case "closeWindow": win.close(); break;
    case "reload": win.webContents.reload(); break;
    case "devTools": win.webContents.toggleDevTools(); break;
    case "undo": win.webContents.undo(); break;
    case "redo": win.webContents.redo(); break;
    case "cut": win.webContents.cut(); break;
    case "copy": win.webContents.copy(); break;
    case "paste": win.webContents.paste(); break;
    case "selectAll": win.webContents.selectAll(); break;
  }
}
