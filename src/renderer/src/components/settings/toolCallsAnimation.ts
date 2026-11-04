import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hermes.toolCallsAnimation";
const CHANGE_EVENT = "hermes-tool-calls-animation-changed";

/** Opt-in read-only animated file tool preview during generation. */
export function readToolCallsAnimation(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useToolCallsAnimation(): readonly [
  boolean,
  (next: boolean) => boolean,
] {
  const enabled = useSyncExternalStore(
    subscribe,
    readToolCallsAnimation,
    (): boolean => false,
  );
  const setEnabled = useCallback((next: boolean): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }, []);
  return [enabled, setEnabled];
}
