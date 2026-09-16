import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { DashboardRpcEvent } from "../dashboardGatewayClient";

export interface ActiveSubagent {
  subagent_id: string;
  goal?: string;
  child_session_id?: string;
}

function childRecord(value: unknown): ActiveSubagent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.subagent_id !== "string" || !row.subagent_id) return null;
  return {
    subagent_id: row.subagent_id,
    ...(typeof row.goal === "string" ? { goal: row.goal } : {}),
    ...(typeof row.child_session_id === "string"
      ? { child_session_id: row.child_session_id }
      : {}),
  };
}

export function useActiveSubagents(
  enabled: boolean,
  sessionRef: RefObject<string | null>,
  clientRef: RefObject<{
    request: (
      method: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;
  } | null>,
): {
  activeSubagents: ActiveSubagent[];
  onSubagentEvent: (event: DashboardRpcEvent) => void;
} {
  const [roster, setRoster] = useState<{
    session: string | null;
    children: ActiveSubagent[];
  }>({ session: null, children: [] });
  const pendingRef = useRef<Map<string, ActiveSubagent | null> | null>(null);
  const onSubagentEvent = useCallback(
    (event: DashboardRpcEvent) => {
      const session = sessionRef.current;
      if (!enabled || !session || event.session_id !== session) return;
      if (
        ![
          "subagent.start",
          "subagent.tool",
          "subagent.thinking",
          "subagent.progress",
          "subagent.complete",
        ].includes(event.type)
      )
        return;
      const child = childRecord(event.payload);
      if (!child) return;
      const value = event.type === "subagent.complete" ? null : child;
      pendingRef.current?.set(child.subagent_id, value);
      setRoster((previous) => {
        const children = new Map(
          (previous.session === session ? previous.children : []).map((row) => [
            row.subagent_id,
            row,
          ]),
        );
        if (value)
          children.set(child.subagent_id, {
            ...children.get(child.subagent_id),
            ...value,
          });
        else children.delete(child.subagent_id);
        return { session, children: [...children.values()] };
      });
    },
    [enabled, sessionRef],
  );

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let busy = false;
    const poll = async (): Promise<void> => {
      const session = sessionRef.current;
      const client = clientRef.current;
      if (busy || !session || !client) return;
      busy = true;
      const updates = new Map<string, ActiveSubagent | null>();
      pendingRef.current = updates;
      try {
        const response = await client.request("subagent.list", {
          session_id: session,
        });
        if (
          disposed ||
          sessionRef.current !== session ||
          clientRef.current !== client
        )
          return;
        const rows = (response as { subagents?: unknown } | null)?.subagents;
        if (!Array.isArray(rows)) return; // Malformed/failed snapshots mean unknown, not empty.
        const children = new Map<string, ActiveSubagent>();
        for (const row of rows) {
          const child = childRecord(row);
          if (
            child &&
            row.status === "running" &&
            (!row.parent_id || row.parent_id === session)
          )
            children.set(child.subagent_id, child);
        }
        // Events received during the RPC are newer than its snapshot.
        for (const [id, child] of updates) {
          if (child) children.set(id, { ...children.get(id), ...child });
          else children.delete(id);
        }
        setRoster({ session, children: [...children.values()] });
      } catch {
        // Keep the last known roster; retry even when the parent is idle.
      } finally {
        if (pendingRef.current === updates) pendingRef.current = null;
        busy = false;
      }
    };
    void poll();
    // ponytail: running children only; queued totals need a backend snapshot contract.
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
      pendingRef.current = null;
    };
  }, [enabled, sessionRef, clientRef]);

  return {
    activeSubagents:
      enabled && roster.session === sessionRef.current ? roster.children : [],
    onSubagentEvent,
  };
}
