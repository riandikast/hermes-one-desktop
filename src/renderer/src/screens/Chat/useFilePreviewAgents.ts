import { useEffect, useState } from "react";
import type { ActiveSubagent } from "./hooks/useActiveSubagents";
import { dbItemsToChatMessages } from "./sessionHistory";
import type { ChatMessage } from "./types";

export interface PreviewAgent {
  id: string;
  label: string;
  messages: readonly ChatMessage[];
  status?: string;
}

/** Read bounded child tails sequentially; never resume/create a child runtime. */
export function useFilePreviewAgents(
  children: readonly ActiveSubagent[],
  enabled: boolean,
  sessionKey?: string,
): PreviewAgent[] {
  const ids = JSON.stringify(
    children
      .slice(0, 8)
      .map((child) => child.child_session_id)
      .filter((id): id is string => !!id),
  );
  const [tails, setTails] = useState<{
    key: string;
    rows: Record<string, ChatMessage[]>;
  }>({ key: "", rows: {} });
  const key = `${sessionKey ?? ""}:${ids}`;
  useEffect(() => {
    if (!enabled || ids === "[]") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sessions = JSON.parse(ids) as string[];
    const poll = async (): Promise<void> => {
      const rows: Record<string, ChatMessage[]> = {};
      for (const id of sessions) {
        if (disposed) return;
        try {
          const page = await window.hermesAPI.getSessionMessagesBefore(
            id,
            undefined,
            60,
          );
          if (disposed) return;
          rows[id] = dbItemsToChatMessages(page.items);
        } catch {
          /* Keep the prior tail on transient read errors. */
        }
      }
      if (disposed) return;
      setTails((previous) => ({
        key,
        rows: { ...(previous.key === key ? previous.rows : {}), ...rows },
      }));
      timer = setTimeout(() => {
        void poll();
      }, 2000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, ids, key]);
  return children.slice(0, 8).map((child) => ({
    id: child.child_session_id ?? child.subagent_id,
    label: child.subagent_id,
    messages:
      tails.key === key ? (tails.rows[child.child_session_id ?? ""] ?? []) : [],
    status: child.last_tool ?? child.status ?? "Working…",
  }));
}
