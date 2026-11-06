import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "../../screens/Chat/reasoningTiers";

/**
 * Reasoning level applied to chats that have no per-chat pick yet. Chosen on
 * the Providers page; a composer selection always wins for that chat.
 *
 * Renderer-only: no `agent.reasoning_effort` config write happens here. The
 * chosen tier travels to the gateway as the existing session-scoped
 * `config.set` before `prompt.submit`.
 */
const STORAGE_KEY = "hermes.reasoning.default";
const CHANGE_EVENT = "hermes-default-reasoning-changed";

let cachedRaw: string | null = null;
let cached: ReasoningEffort = DEFAULT_REASONING_EFFORT;

export function readDefaultReasoning(): ReasoningEffort {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_REASONING_EFFORT;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = raw ? normalizeReasoningEffort(raw) : DEFAULT_REASONING_EFFORT;
  return cached;
}

export function writeDefaultReasoning(next: ReasoningEffort): boolean {
  const value = normalizeReasoningEffort(next);
  try {
    localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useDefaultReasoning(): readonly [
  ReasoningEffort,
  (next: ReasoningEffort) => boolean,
] {
  const value = useSyncExternalStore(
    subscribe,
    readDefaultReasoning,
    (): ReasoningEffort => DEFAULT_REASONING_EFFORT,
  );
  const setValue = useCallback(
    (next: ReasoningEffort): boolean => writeDefaultReasoning(next),
    [],
  );
  return [value, setValue];
}
