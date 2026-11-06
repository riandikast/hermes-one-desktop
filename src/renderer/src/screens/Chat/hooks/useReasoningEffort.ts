import { useCallback, useEffect, useRef, useState } from "react";
import { readDefaultReasoning } from "../../../components/settings/defaultReasoning";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "../reasoningTiers";

export {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  type ReasoningEffort,
};

interface UseReasoningEffortResult {
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (next: ReasoningEffort) => Promise<void>;
}

export function useReasoningEffort(profile?: string, sessionId?: string | null, draftId = "draft"): UseReasoningEffortResult {
  const key = JSON.stringify(["hermes.chat.reasoning.v1", profile || "default", sessionId || draftId]);
  const read = (k: string): ReasoningEffort => {
    // A chat with no pick of its own starts at Settings → Providers' default.
    try {
      const stored = localStorage.getItem(k);
      return stored === null ? readDefaultReasoning() : normalizeReasoningEffort(stored);
    } catch { return readDefaultReasoning(); }
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
