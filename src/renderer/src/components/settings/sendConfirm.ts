import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hermes.sendConfirm";
const CHANGE_EVENT = "hermes-send-confirm-changed";

/**
 * Ask before sending a prompt: the first Enter only arms the send and shows the
 * target project, a second Enter (or the dialog's button) dispatches it.
 *
 * OFF by default — Enter sends immediately unless the user opts in from
 * Settings → Utils.
 */
export function readSendConfirm(): boolean {
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

export function useSendConfirm(): readonly [
  boolean,
  (next: boolean) => boolean,
] {
  const enabled = useSyncExternalStore(
    subscribe,
    readSendConfirm,
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
