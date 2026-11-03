import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { validateShortcutOverrides, type ShortcutOverrides } from "../shared/keyboard-shortcuts";

let cached: ShortcutOverrides | undefined;
export let shortcutRecording = false;
export function setShortcutRecording(value: boolean): void { shortcutRecording = value; }

/** Desktop-owned user data survives updates; never rewrite bundled defaults. */
export function getKeyboardShortcuts(): ShortcutOverrides {
  if (cached) return cached;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(app.getPath("userData"), "keyboard-shortcuts.json"), "utf8"));
    if (!validateShortcutOverrides(parsed)) return cached = parsed as ShortcutOverrides;
  } catch { /* Missing or corrupt preferences retain shipped shortcuts. */ }
  return cached = {};
}

export function setKeyboardShortcuts(value: unknown): { ok: boolean; error?: string } {
  const error = validateShortcutOverrides(value);
  if (error) return { ok: false, error };
  const next = value as ShortcutOverrides;
  try {
    const dir = app.getPath("userData");
    const path = join(dir, "keyboard-shortcuts.json");
    mkdirSync(dir, { recursive: true });
    if (Object.keys(next).length === 0) rmSync(path, { force: true });
    else {
      writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), "utf8");
      renameSync(`${path}.tmp`, path);
    }
    cached = JSON.parse(JSON.stringify(next)) as ShortcutOverrides;
    return { ok: true };
  } catch { return { ok: false, error: "Could not save keyboard shortcuts." }; }
}
