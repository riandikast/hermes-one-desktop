import { useCallback, useSyncExternalStore } from "react";

/**
 * Default auto-save behaviour for newly opened file-editor tabs.
 *
 * Default ON: only an explicit "false" turns it off, so upgrading users keep
 * the behaviour they had before the preference existed. Editors already open
 * keep their own per-file value; the default applies to files opened next.
 */
const STORAGE_KEY = "hermes.fileEditor.autoSave";
const CHANGE_EVENT = "hermes-file-autosave-changed";

export function readFileAutosaveDefault(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useFileAutosaveDefault(): readonly [
  boolean,
  (next: boolean) => boolean,
] {
  const autoSave = useSyncExternalStore(
    subscribe,
    readFileAutosaveDefault,
    (): boolean => true,
  );
  const setDefault = useCallback((next: boolean): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }, []);
  return [autoSave, setDefault];
}
