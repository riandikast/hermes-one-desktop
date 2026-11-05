import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "hermes.knowledge.defaults";
const CHANGE_EVENT = "hermes-default-knowledge-changed";

let cachedRaw: string | null = null;
let cachedNames: string[] = [];

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Bundle names attached to every NEW session. Empty unless the user picks some
 * in Settings → Utils. Kept in selection order (an array, never a Set).
 */
export function readDefaultKnowledge(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === cachedRaw) return cachedNames;
  cachedRaw = raw;
  if (!raw) {
    cachedNames = [];
    return cachedNames;
  }
  try {
    cachedNames = normalize(JSON.parse(raw));
  } catch {
    cachedNames = [];
  }
  return cachedNames;
}

/**
 * What a chat should start with: an explicit handoff list always wins (even an
 * empty one), an existing session starts from its own stored list, and only a
 * brand-new session inherits the defaults.
 */
export function sessionStartKnowledge(
  sessionId: string | null | undefined,
  handoff?: string[],
): string[] {
  if (handoff) return handoff;
  return sessionId ? [] : readDefaultKnowledge();
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function writeDefaultKnowledge(next: string[]): boolean {
  try {
    const names = normalize(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function useDefaultKnowledge(): readonly [
  string[],
  (next: string[]) => boolean,
] {
  const names = useSyncExternalStore(
    subscribe,
    readDefaultKnowledge,
    (): string[] => [],
  );
  const setNames = useCallback((next: string[]): boolean => {
    return writeDefaultKnowledge(next);
  }, []);
  return [names, setNames];
}
