import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { dbItemsToChatMessages, reconcileAfterDbRefresh } from "../sessionHistory";
import type { ChatMessage } from "../types";

export function useSessionRefresh(sessionId: string | null, isLoading: boolean,
  messages: ChatMessage[], setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onRefreshed?: () => void,
): { refreshing: boolean; refresh: () => Promise<void> } {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const current = useRef({ sessionId, isLoading, messages });
  current.current = { sessionId, isLoading, messages };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    const start = current.current;
    if (!start.sessionId || start.isLoading || busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const items = await window.hermesAPI.getSessionMessages(start.sessionId);
      // Never replace a newer turn, switched session, or concurrently edited transcript.
      const valid = (): boolean => mounted.current && current.current.sessionId === start.sessionId
        && !current.current.isLoading && current.current.messages === start.messages;
      if (!valid()) return;
      const db = dbItemsToChatMessages(items);
      onRefreshed?.();
      setMessages((previous) => valid() && previous === start.messages
        ? reconcileAfterDbRefresh(previous, db) : previous);
    } catch {
      if (mounted.current && current.current.sessionId === start.sessionId)
        toast.error("Failed to refresh session. Existing messages were kept.");
    } finally {
      busy.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [setMessages, onRefreshed]);
  return { refreshing, refresh };
}
