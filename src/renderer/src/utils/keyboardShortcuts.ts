import { useSyncExternalStore } from "react";
import {
  bindingsFor, matchesBinding, validateShortcutOverrides,
  type ShortcutId, type ShortcutOverrides,
} from "../../../shared/keyboard-shortcuts";

let overrides: ShortcutOverrides = {};
let recording = false;
const listeners = new Set<() => void>();
const publish = (next: ShortcutOverrides): void => {
  overrides = next;
  for (const listener of listeners) listener();
};
export const shortcutPlatform = (): string =>
  window.electron?.process?.platform ?? (navigator.platform.includes("Mac") ? "darwin" : "win32");

export function matchesShortcut(event: Parameters<typeof matchesBinding>[0], id: ShortcutId): boolean {
  return !recording && bindingsFor(id, overrides, shortcutPlatform()).some((binding) => matchesBinding(event, binding, shortcutPlatform()));
}
export function shortcutLabel(id: ShortcutId): string {
  return bindingsFor(id, overrides, shortcutPlatform()).map((binding) => binding.replace(/Mod/g, shortcutPlatform() === "darwin" ? "Cmd" : "Ctrl")).join(" / ") || "Unassigned";
}
export function useKeyboardShortcuts(): ShortcutOverrides {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => overrides);
}
export async function loadKeyboardShortcuts(): Promise<void> {
  const value = await window.hermesAPI.getKeyboardShortcuts?.();
  if (value && !validateShortcutOverrides(value)) publish(value);
}
export async function saveKeyboardShortcuts(next: ShortcutOverrides): Promise<void> {
  const error = validateShortcutOverrides(next);
  if (error) throw new Error(error);
  const result = await window.hermesAPI.setKeyboardShortcuts(next);
  if (!result.ok) throw new Error(result.error || "Could not save keyboard shortcuts.");
  // Read the authoritative saved target rather than assuming the write applied.
  const saved = await window.hermesAPI.getKeyboardShortcuts();
  if (validateShortcutOverrides(saved)) throw new Error("Saved keyboard shortcuts could not be read.");
  publish(saved);
}
export function setShortcutRecording(active: boolean): void {
  recording = active;
  void window.hermesAPI.setShortcutRecording?.(active);
}
export function shortcutRecordingActive(): boolean { return recording; }
