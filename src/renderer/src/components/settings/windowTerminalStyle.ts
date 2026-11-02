import { useCallback, useSyncExternalStore } from "react";

export type WindowTerminalStyle = "dialog" | "sidebar";

const STORAGE_KEY = "hermes.windowTerminalStyle";
const CHANGE_EVENT = "hermes-window-terminal-style-changed";

function readStyle(): WindowTerminalStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === "sidebar"
      ? "sidebar"
      : "dialog";
  } catch {
    return "dialog";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useWindowTerminalStyle(): readonly [
  WindowTerminalStyle,
  (style: WindowTerminalStyle) => boolean,
] {
  const style = useSyncExternalStore(
    subscribe,
    readStyle,
    (): WindowTerminalStyle => "dialog",
  );
  const setStyle = useCallback((next: WindowTerminalStyle): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }, []);
  return [style, setStyle];
}
