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
  /** The child's own session id — the handle needed to open its transcript. */
  child_session_id?: string;
  /** Last started tool (NOT necessarily in-flight — backend contract). */
  last_tool?: string;
  tool_count?: number;
  /** Backend status string while live (e.g. "running"). */
  status?: string;
  /** Epoch ms the child started, when the backend reports it. */
  started_at?: number;
  /** Whether the child currently accepts a steer message. */
  accepting_steer?: boolean;
}

/**
 * Statuses that mean "this child is finished/failed" — the ONLY ones that
 * exclude a row from the live roster. Anything else (running, starting,
 * queued, waiting, or a status the backend did not send) counts as in-flight,
 * because a spawned child IS work in flight, and hiding it made the loading
 * indicator silently absent on models that word the status differently.
 */
const TERMINAL_SUBAGENT_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "stopped",
]);

function strOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * True when two rosters are equivalent: same session and the same children in
 * the same order with the same fields.
 *
 * The poll rebuilds `children` as a fresh array (and fresh objects) on EVERY
 * tick, so `setRoster` was called unconditionally. React compares state by
 * identity, so an unchanged roster still produced a new object and re-rendered
 * every consumer — including the whole chat transcript. Measured with an empty
 * roster (the common case): a 300-450 ms main-thread block every 5 s while
 * idle, with ZERO DOM changes, i.e. pure wasted reconciliation. Skipping the
 * identical write is what removes that wave.
 *
 * Compared field-by-field (not by JSON) so the order of keys and any future
 * key addition cannot silently defeat the check.
 */
export function rostersEqual(
  a: { session: string | null; children: ReadonlyArray<ActiveSubagent> },
  b: { session: string | null; children: ReadonlyArray<ActiveSubagent> },
): boolean {
  if (a.session !== b.session) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    const x = a.children[i]!;
    const y = b.children[i]!;
    if (
      x.subagent_id !== y.subagent_id ||
      x.goal !== y.goal ||
      x.child_session_id !== y.child_session_id ||
      x.last_tool !== y.last_tool ||
      x.tool_count !== y.tool_count ||
      x.status !== y.status ||
      x.started_at !== y.started_at ||
      x.accepting_steer !== y.accepting_steer
    ) {
      return false;
    }
  }
  return true;
}

function childRecord(value: unknown): ActiveSubagent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.subagent_id !== "string" || !row.subagent_id) return null;
  return {
    subagent_id: row.subagent_id,
    ...(strOrUndefined(row.goal) ? { goal: row.goal as string } : {}),
    ...(strOrUndefined(row.child_session_id)
      ? { child_session_id: row.child_session_id as string }
      : {}),
    ...(strOrUndefined(row.last_tool)
      ? { last_tool: row.last_tool as string }
      : {}),
    ...(strOrUndefined(row.status)
      ? { status: row.status as string }
      : {}),
    ...(numOrUndefined(row.tool_count)
      ? { tool_count: row.tool_count as number }
      : {}),
    // Backend reports started_at as epoch seconds; convert for display.
    ...(numOrUndefined(row.started_at)
      ? { started_at: (row.started_at as number) * 1000 }
      : {}),
    ...(typeof row.accepting_steer === "boolean"
      ? { accepting_steer: row.accepting_steer }
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
  /**
   * Whether this run's tab is the VISIBLE one. Every open tab keeps a mounted
   * <Chat> (Layout hides the inactive ones with `display: none`), so `enabled`
   * — a CONNECTION-level flag — is true for all of them. Polling from hidden
   * tabs multiplies the 5s `subagent.list` RPC by the number of open tabs and,
   * on a long transcript, its roster commit re-renders that tab's whole
   * message list: the stutter/freeze that grows with each tab opened. A hidden
   * tab shows no subagent strip, so it has nothing to poll for — it resumes on
   * activation. Defaults to true so non-tab callers keep working.
   */
  active = true,
): {
  activeSubagents: ActiveSubagent[];
  onSubagentEvent: (event: DashboardRpcEvent) => void;
} {
  const [roster, setRoster] = useState<{
    session: string | null;
    children: ActiveSubagent[];
  }>({ session: null, children: [] });
  const pendingRef = useRef<Map<string, ActiveSubagent | null> | null>(null);
  // Mirror of the committed roster. The poll builds a FRESH children map each
  // tick, so without this it has nothing to merge a sparse snapshot onto and
  // fields only the event stream knows (notably `child_session_id`, which
  // `subagent.list` frequently omits) would be lost on the very next tick —
  // taking the "View" button with them.
  const rosterRef = useRef<{ session: string | null; children: ActiveSubagent[] }>({
    session: null,
    children: [],
  });
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
      const scoped =
        rosterRef.current.session === session ? rosterRef.current.children : [];
      rosterRef.current = {
        session,
        children: value
          ? [
              ...scoped.filter((r) => r.subagent_id !== child.subagent_id),
              {
                ...scoped.find((r) => r.subagent_id === child.subagent_id),
                ...value,
              },
            ]
          : scoped.filter((r) => r.subagent_id !== child.subagent_id),
      };
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
    if (!enabled || !active) return;
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
        // Seeded from the last committed roster so a sparse snapshot MERGES
        // onto fields only the event stream knows (e.g. child_session_id).
        // Only when the ref describes THIS session: seeding across a session
        // switch would carry the previous session's children into the new one.
        const children = new Map<string, ActiveSubagent>(
          (rosterRef.current.session === session
            ? rosterRef.current.children
            : []
          ).map((row) => [row.subagent_id, row]),
        );
        for (const row of rows) {
          const child = childRecord(row);
          if (!child) continue;
          // A spawned child is real work in flight REGARDLESS of the exact
          // status word: models differ on whether they report "running",
          // "starting", "queued" or a missing status at spawn. The old
          // `status === "running"` gate silently hid children on those models
          // (the "subagents spawn but no indicator" report). Only a terminal
          // status excludes a child; the poll's absence of an id removes it.
          const status = typeof row.status === "string" ? row.status : "";
          if (TERMINAL_SUBAGENT_STATUSES.has(status)) continue;
          // `parent_id` is advisory: a nested child (grandchild) or a session
          // id formatted differently used to be filtered out entirely. Show it
          // attributed to this session rather than hide real work.
          //
          // MERGE onto any known row instead of replacing it: the poll snapshot
          // often omits `child_session_id` (the backend sends it on the
          // `subagent.start` event, not always in `subagent.list`). Replacing
          // the entry wiped a known id, which is what made the "View" button
          // appear and then vanish — or never appear at all.
          children.set(child.subagent_id, {
            ...children.get(child.subagent_id),
            ...child,
          });
        }
        // Events received during the RPC are newer than its snapshot.
        for (const [id, child] of updates) {
          if (child) children.set(id, { ...children.get(id), ...child });
          else children.delete(id);
        }
        const committed = [...children.values()];
        rosterRef.current = { session, children: committed };
        // Skip the state write when nothing changed. The poll rebuilds the
        // array every tick, so writing unconditionally re-rendered the entire
        // transcript (a 300-450 ms main-thread block every 5 s, with no DOM
        // change) even with no subagents running. `rosterRef` is updated above
        // regardless, so a later sparse snapshot still merges onto this one.
        setRoster((prev) =>
          rostersEqual(prev, { session, children: committed })
            ? prev
            : { session, children: committed },
        );
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
  }, [enabled, active, sessionRef, clientRef]);

  return {
    activeSubagents:
      enabled && roster.session === sessionRef.current ? roster.children : [],
    onSubagentEvent,
  };
}
