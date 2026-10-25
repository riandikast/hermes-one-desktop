import { useCallback, useEffect, useRef, useState } from "react";

export type ReasoningEffort =
  | "auto"
  | "none"
  | "max"
  | "ultra"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "auto";

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "none" || value === "max" || value === "ultra" || value === "auto" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : DEFAULT_REASONING_EFFORT;
}

interface UseReasoningEffortResult {
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (next: ReasoningEffort) => Promise<void>;
}

export function useReasoningEffort(profile?: string, sessionId?: string | null, draftId = "draft"): UseReasoningEffortResult {
  const key = JSON.stringify(["hermes.chat.reasoning.v1", profile || "default", sessionId || draftId]);
  const read = (k: string): ReasoningEffort => {
    try { return normalizeReasoningEffort(localStorage.getItem(k)); } catch { return "auto"; }
  };
  const [selection, setSelection] = useState(() => ({ key, value: read(key) }));
  const previous = useRef({ key, sessionId, profile, draftId });
  let value = selection.key === key ? selection.value : read(key);
  // The first durable id binds this draft; navigation must never carry its pick.
  if (selection.key !== key && !previous.current.sessionId && sessionId && previous.current.profile === profile && previous.current.draftId === draftId) value = selection.value;
  useEffect(() => {
    if (selection.key !== key) {
      localStorage.setItem(key, value);
      setSelection({ key, value });
    }
    previous.current = { key, sessionId, profile, draftId };
  }, [key, sessionId, profile, draftId, selection, value]);
  const setReasoningEffort = useCallback(async (next: ReasoningEffort): Promise<void> => {
    localStorage.setItem(key, next);
    setSelection({ key, value: next });
  }, [key]);
  return { reasoningEffort: value, setReasoningEffort };
}
