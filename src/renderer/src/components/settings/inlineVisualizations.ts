import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hermes.inlineVisualizations";
const CHANGE_EVENT = "hermes-inline-visualizations-changed";

/**
 * Opt-in right-side preview of an HTML visualization emitted by the
 * assistant. Off by default: model-generated markup only runs when the user
 * asks for it.
 */
export function readInlineVisualizations(): boolean {
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

/**
 * Seeded into a new session so the agent knows the chat contract, not a file
 * protocol. The renderer only executes complete ```html fences.
 */
export const INLINE_VISUALIZATION_PROMPT =
  "Inline visualizations are enabled in this chat. When a visual would explain better than prose, reply with one self-contained HTML fragment in a ```html fenced block. Use inline SVG, canvas, JavaScript and CSS only: no external scripts, stylesheets, fonts, images, network requests, forms or popups. It renders in a sandboxed right-side preview after the fence closes.";

export function useInlineVisualizations(): readonly [
  boolean,
  (next: boolean) => boolean,
] {
  const enabled = useSyncExternalStore(
    subscribe,
    readInlineVisualizations,
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
