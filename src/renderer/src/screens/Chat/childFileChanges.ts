import type { SessionHistoryPage, SessionHistoryRow } from "../../../../shared/session-history";
import type { DashboardStreamEvent } from "./dashboardEventAdapter";
import { extractToolPath, fileEditPaths, isFileEditTool, normalizePathKey } from "./fileChanges";
import { mergePromptFileChanges } from "./fileChangeSummary";
import type { FileChange } from "./types";

export interface ChildEditOwner {
  sessionId: string;
  promptId: string;
}

interface ChildCapture {
  owner: ChildEditOwner;
  sessionId: string;
  complete: boolean;
  beforeId?: number;
  frontier: number;
  newest: number;
  calls: Map<string, SessionHistoryRow>;
  results: Map<string, SessionHistoryRow>;
  seen: Set<string>;
  edits: Array<{ id: number; changes: FileChange[] }>;
  settled: number;
}

/** Only real, paired edit rows qualify. Progress mirrors and stdout are not evidence. */
export function childToolChanges(call: SessionHistoryRow, result: SessionHistoryRow): FileChange[] {
  if (call.kind !== "tool_call" || result.kind !== "tool_result" || !call.callId ||
      call.callId !== result.callId || call.callId.startsWith("submirror:") ||
      !isFileEditTool(call.name ?? "")) return [];
  try {
    const outcome: unknown = JSON.parse(result.content ?? "");
    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return [];
  } catch { return []; } // Plain progress/output text is never edit proof.
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.args ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch { /* No structured hunk available. */ }
  const old = typeof args.old_string === "string" ? args.old_string : undefined;
  const next = typeof args.new_string === "string" ? args.new_string : undefined;
  const content = typeof args.content === "string" ? args.content : undefined;
  return fileEditPaths(call.name!, result.content, args).flatMap((path): FileChange[] => {
    // A child may use another cwd/machine. Never resolve against the parent's cwd
    // or read a same-named local file after the edit to invent a baseline.
    if (!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path) || !extractToolPath({ path })) return [];
    const matches = normalizePathKey(extractToolPath(args) ?? "") === normalizePathKey(path);
    return [{ path, before: matches ? old ?? null : null, after: matches ? next ?? content ?? null : null, beforeKnown: false,
      ...(matches && old !== undefined ? { removed: old === "" ? [] : old.split("\n") } : {}),
      ...(matches && next !== undefined ? { added: next === "" ? [] : next.split("\n") } : {}),
    }];
  });
}

/** Spawn-time ownership; sequential bounded history reads, independent of preview settings. */
export class ChildFileChangeCollector {
  private children = new Map<string, ChildCapture>();
  private known = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private disposed = false;

  constructor(
    private readPage: (sessionId: string, beforeId?: number, limit?: number) => Promise<SessionHistoryPage>,
    private publish: (owner: ChildEditOwner, changes: FileChange[]) => void,
  ) {}

  event(event: DashboardStreamEvent, parentSessionId: string | null, owner: ChildEditOwner | null): void {
    if (this.disposed || !parentSessionId || event.session_id !== parentSessionId ||
        !event.payload || typeof event.payload !== "object") return;
    const payload = event.payload as Record<string, unknown>;
    const id = typeof payload.subagent_id === "string" ? payload.subagent_id : "";
    if (!id) return;
    if (event.type === "subagent.start" && owner && typeof payload.child_session_id === "string" &&
        payload.child_session_id && !this.known.has(id)) {
      this.known.add(id);
      this.children.set(id, { owner, sessionId: payload.child_session_id, complete: false,
        frontier: 0, newest: 0, calls: new Map(), results: new Map(), seen: new Set(), edits: [], settled: 0 });
    }
    const child = this.children.get(id);
    if (event.type === "subagent.complete" && child) child.complete = true;
    if (this.children.size && !this.timer && !this.busy) void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.busy) return;
    this.busy = true;
    try {
      for (const [id, child] of this.children) {
        if (this.disposed) return;
        try {
          // One page per child per pass. Continue older pages on later passes;
          // a long child is never truncated to its latest 60/100 rows.
          const page = await this.readPage(child.sessionId, child.beforeId, 100);
          if (this.disposed) return;
          for (const row of page.items) {
            child.newest = Math.max(child.newest, row.id);
            if (!row.callId || child.seen.has(row.callId) ||
                (row.id <= child.frontier && !child.calls.has(row.callId) && !child.results.has(row.callId))) continue;
            if (row.kind === "tool_call" && isFileEditTool(row.name ?? "")) child.calls.set(row.callId, row);
            if (row.kind === "tool_result" && isFileEditTool(row.name ?? "")) child.results.set(row.callId, row);
            const call = child.calls.get(row.callId);
            const result = child.results.get(row.callId);
            if (!call || !result) continue;
            child.edits.push({ id: result.id, changes: childToolChanges(call, result) });
            child.seen.add(row.callId);
            child.calls.delete(row.callId);
            child.results.delete(row.callId);
          }
          const reachedFrontier = !page.hasMore || page.oldestId === null ||
            (page.oldestId <= child.frontier && child.results.size === 0);
          if (reachedFrontier) {
            // Backward pages arrive newest-first; publish only after sorting the
            // whole unseen range so earliest before/latest after stay truthful.
            const changes = child.edits.sort((a, b) => a.id - b.id)
              .reduce<FileChange[]>((all, edit) => mergePromptFileChanges(all, edit.changes), []);
            if (changes.length) this.publish(child.owner, changes);
            child.edits = [];
            child.settled = child.newest === child.frontier ? child.settled + 1 : 0;
            child.frontier = child.newest;
            child.beforeId = undefined;
            child.seen.clear();
            if (child.complete && child.settled >= 2) this.children.delete(id);
          } else if (page.oldestId !== child.beforeId) child.beforeId = page.oldestId!;
        } catch { /* Retry a transient/lagging child DB read; keep its original owner. */ }
      }
    } finally {
      this.busy = false;
      if (!this.disposed && this.children.size) this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.poll();
      }, 2000);
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.children.clear();
  }
}
