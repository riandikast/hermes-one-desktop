import type Database from "better-sqlite3";
import { getDbConnection } from "./db";

/**
 * Desktop-owned, per-session store for the working folder the user links to a
 * conversation (issue #27). The folder is a desktop-only UI binding — the agent
 * receives it per message as a context-folder system message — so it isn't part
 * of hermes-agent's session schema. Persisting it here lets a re-opened session
 * restore its linked folder instead of losing it when the app restarts.
 *
 * Mirrors the [[src/main/session-continuation-store.ts]] pattern: a desktop
 * table in the active profile's state.db, keyed by `session_id`.
 */
const TABLE = "desktop_session_context_folders";
/** Multi-root table: one row per linked folder per session, position-ordered. */
const TABLE_ROOTS = "desktop_session_context_folder_roots";

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function ensureRootsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_ROOTS} (
      session_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      position INTEGER NOT NULL,
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (session_id, folder_path)
    );
  `);
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE) as { name: string } | undefined;
  return !!row;
}

function rootsTableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE_ROOTS) as { name: string } | undefined;
  return !!row;
}

/**
 * Persist (or clear) the folders linked to a session. An empty array removes
 * the rows so an unlinked session doesn't restore stale paths.
 */
export function setSessionContextFolders(
  sessionId: string,
  folders: string[],
): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);
  ensureRootsTable(db);

  const clean = (folders ?? [])
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  db.prepare(`DELETE FROM ${TABLE_ROOTS} WHERE session_id = ?`).run(sessionId);
  clean.forEach((folder, i) => {
    db.prepare(
      `INSERT INTO ${TABLE_ROOTS} (session_id, folder_path, position, updated_at)
       VALUES (?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(session_id, folder_path) DO UPDATE SET
         position = excluded.position,
         updated_at = excluded.updated_at`,
    ).run(sessionId, folder, i);
  });
  if (clean.length === 0) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
}

/** Legacy single-folder setter; kept for one-shot migration use. */
export function setSessionContextFolder(
  sessionId: string,
  folder: string | null,
): void {
  setSessionContextFolders(sessionId, folder ? [folder] : []);
}

/** Read the legacy single folder linked to a session, or null. */
export function getSessionContextFolder(sessionId: string): string | null {
  if (!sessionId) return null;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return null;
  const row = db
    .prepare(`SELECT folder_path FROM ${TABLE} WHERE session_id = ?`)
    .get(sessionId) as { folder_path: string } | undefined;
  return row?.folder_path || null;
}

/**
 * Read the folders linked to a session, in selection order. Sessions that
 * only have a legacy single-folder row are lazily migrated to the roots
 * table on first read.
 */
export function getSessionContextFoldersForSession(
  sessionId: string,
): string[] {
  if (!sessionId) return [];
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  ensureRootsTable(db);
  const rows = db
    .prepare(
      `SELECT folder_path FROM ${TABLE_ROOTS} WHERE session_id = ? ORDER BY position ASC`,
    )
    .all(sessionId) as Array<{ folder_path: string }>;
  const roots = rows.map((r) => r.folder_path);
  if (roots.length === 0) {
    const legacy = getSessionContextFolder(sessionId);
    if (legacy) {
      setSessionContextFolders(sessionId, [legacy]);
      return [legacy];
    }
  }
  return roots;
}

/**
 * Batch-read the folders linked to many sessions in a single pass: one
 * table-existence check and one chunked `IN (...)` query instead of two
 * queries per session. Used by the session cache so attaching folders to a
 * full page of rows stays a couple of queries rather than O(N). Sessions
 * with no linked folders are simply absent from the returned map.
 */
export function getSessionContextFolders(
  sessionIds: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (sessionIds.length === 0) return result;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return result;
  ensureRootsTable(db);

  // Chunk well under SQLITE_MAX_VARIABLE_NUMBER for portability, matching the
  // batching used elsewhere in the session cache.
  const CHUNK = 500;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT session_id, folder_path FROM ${TABLE_ROOTS} WHERE session_id IN (${placeholders}) ORDER BY session_id, position ASC`,
      )
      .all(...chunk) as Array<{ session_id: string; folder_path: string }>;
    for (const r of rows) {
      const list = result.get(r.session_id) ?? [];
      if (r.folder_path) list.push(r.folder_path);
      result.set(r.session_id, list);
    }
  }
  // Lazy-migrate sessions that only have a legacy single-folder row.
  for (const sessionId of sessionIds) {
    if (!result.has(sessionId)) {
      const legacy = getSessionContextFolder(sessionId);
      if (legacy) {
        setSessionContextFolders(sessionId, [legacy]);
        result.set(sessionId, [legacy]);
      }
    }
  }
  return result;
}

/**
 * Drop a session's linked-folder rows. Called from `deleteSessionRows` so it
 * runs inside the same delete transaction as the other per-session cleanup.
 */
export function deleteSessionContextFolderForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (tableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
  if (rootsTableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE_ROOTS} WHERE session_id = ?`).run(sessionId);
  }
}

/**
 * Get recent distinct context folder paths ordered by most recently updated.
 * Covers both the roots table and legacy single-folder rows.
 */
export function getRecentSessionContextFolders(limit = 20): string[] {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  // GROUP BY (not DISTINCT) so each folder appears once ordered by its most
  // recent use. A `DISTINCT folder_path ... ORDER BY updated_at` collapses the
  // duplicates but then orders by an arbitrary one of each path's rows, so a
  // folder reused recently could sort as if it were old.
  const rootsRows = rootsTableExists(db)
    ? (db
        .prepare(
          `SELECT folder_path, MAX(updated_at) AS latest FROM ${TABLE_ROOTS}
           WHERE folder_path IS NOT NULL AND folder_path != ''
           GROUP BY folder_path`,
        )
        .all() as Array<{ folder_path: string; latest: number }>)
    : [];
  const legacyRows = (db
    .prepare(
      `SELECT folder_path, updated_at AS latest FROM ${TABLE}
       WHERE folder_path IS NOT NULL AND folder_path != ''
       GROUP BY folder_path`,
    )
    .all() as Array<{ folder_path: string; latest: number }>);
  const merged = new Map<string, number>();
  for (const r of [...rootsRows, ...legacyRows]) {
    const prev = merged.get(r.folder_path);
    if (prev === undefined || r.latest > prev) merged.set(r.folder_path, r.latest);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path]) => path);
}
