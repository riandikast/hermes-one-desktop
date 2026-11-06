/**
 * Cross-process "is this session's turn running?" — read from state.db's
 * `session_turn_leases` table.
 *
 * `session.active_list` only lists live sessions in the backend THIS window
 * spawned, so a turn started by another app (a `hermes` CLI/oneshot run, the
 * installed gateway, another desktop window) is invisible to it. Every runtime
 * takes the same DB lease for the duration of a turn and deletes it when the
 * turn ends, which makes the lease the one signal that spans processes.
 */
import { getDbConnection } from "./db";
import { getManagedDashboardPids } from "./dashboard";
import type {
  SessionTurnActivity,
  StopSessionTurnResult,
} from "../shared/turn-activity";

interface DbLike {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

interface LeaseRow {
  holder?: string;
  acquired_at?: number;
  expires_at?: number;
}

const HOLDER_PID = /(?:^|:)pid=(\d+)(?=:|$)/;
const HOLDER_PLATFORM = /(?:^|:)platform=([^:]*)/;
const HOLDER_PIDNS = /(?:^|:)pidns=([^:]*)/;

/** A live holder's expired lease still means "running" this long (refresh gap). */
const LIVE_HOLDER_GRACE_MS = 120_000;

const INACTIVE: SessionTurnActivity = {
  active: false,
  holderPid: null,
  holderAlive: null,
  platform: null,
  acquiredAt: null,
  expiresAt: null,
};

/**
 * PID liveness probe. `null` when the holder cannot be probed from this
 * process — a `pidns=` stamp names another PID namespace, so a local probe
 * would be meaningless and the lease's own expiry must decide.
 */
function probePid(holder: string, pid: number | null): boolean | null {
  if (!pid) return null;
  if (HOLDER_PIDNS.test(holder)) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The lease key is the conversation's lineage root: compressions chain a child
 * session onto its parent and the runtime serializes the whole lineage on the
 * root, mirroring hermes-agent's `_session_turn_lease_key_on_conn`.
 */
export function resolveLeaseKey(db: DbLike, sessionId: string): string {
  const read = (id: string): { parent_session_id?: string | null; end_reason?: string | null } | undefined => {
    try {
      return db
        .prepare("SELECT parent_session_id, end_reason FROM sessions WHERE id = ?")
        .get(id) as { parent_session_id?: string | null; end_reason?: string | null } | undefined;
    } catch {
      return undefined;
    }
  };
  let current = sessionId;
  const seen = new Set([current]);
  for (let depth = 0; depth < 64; depth += 1) {
    const row = read(current);
    const parentId = row?.parent_session_id;
    if (!parentId || seen.has(parentId)) break;
    const parent = read(parentId);
    if (!parent || parent.end_reason !== "compression") break;
    seen.add(parentId);
    current = parentId;
  }
  return current;
}

/** Pure read of one session's lease against an already-open connection. */
export function readTurnActivity(
  db: DbLike,
  sessionId: string,
  now = Date.now(),
): SessionTurnActivity {
  if (!sessionId) return INACTIVE;
  const key = resolveLeaseKey(db, sessionId);
  let row: LeaseRow | undefined;
  try {
    row = db
      .prepare("SELECT holder, acquired_at, expires_at FROM session_turn_leases WHERE conversation_id = ?")
      .get(key) as LeaseRow | undefined;
  } catch {
    // Older state.db without the table: no cross-process tracking available.
    return INACTIVE;
  }
  if (!row) return INACTIVE;

  const holder = String(row.holder ?? "");
  const pid = Number(HOLDER_PID.exec(holder)?.[1] ?? 0) || null;
  const platform = HOLDER_PLATFORM.exec(holder)?.[1] || null;
  const expiresAt = typeof row.expires_at === "number" ? row.expires_at * 1000 : null;
  const acquiredAt = typeof row.acquired_at === "number" ? row.acquired_at * 1000 : null;
  const alive = probePid(holder, pid);

  // A dead holder is proof the turn is over, whatever the row says. A live
  // holder keeps the lease authoritative for a short grace past expiry: the
  // backend refreshes on transcript writes, so a long silent model call can
  // outlive the TTL while still running. Without a probeable pid only the
  // row's own expiry counts.
  const active =
    alive === false
      ? false
      : expiresAt !== null &&
        expiresAt > now - (alive === true ? LIVE_HOLDER_GRACE_MS : 0);

  return {
    active,
    holderPid: pid,
    holderAlive: alive,
    platform,
    acquiredAt,
    expiresAt,
  };
}

export function getSessionTurnActivity(sessionId: string): SessionTurnActivity {
  const db = getDbConnection(true);
  if (!db) return INACTIVE;
  return readTurnActivity(db as unknown as DbLike, sessionId);
}

function isOwnBackend(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    return getManagedDashboardPids().includes(pid);
  } catch {
    return false;
  }
}

/**
 * Terminate the process that owns a foreign turn. Destructive by definition —
 * the renderer must confirm with the user first, and only call this when its
 * own gateway cannot interrupt the session.
 */
export async function stopSessionTurn(sessionId: string): Promise<StopSessionTurnResult> {
  const activity = getSessionTurnActivity(sessionId);
  if (!activity.active) return { stopped: false, pid: activity.holderPid, reason: "inactive" };
  const pid = activity.holderPid;
  if (!pid) return { stopped: false, pid: null, reason: "unknown-holder" };
  if (isOwnBackend(pid)) return { stopped: false, pid, reason: "own-process" };

  try {
    if (process.platform === "win32") {
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    return { stopped: false, pid, reason: "failed" };
  }

  // Confirm the holder actually went away; a live pid still means a live turn.
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (probePid(`pid=${pid}`, pid) === false) return { stopped: true, pid };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { stopped: false, pid, reason: "failed" };
}
