import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  activeStateDbPath,
  profileHome,
  getActiveProfileNameSync,
  safeWriteFile,
} from "./utils";
import Database from "better-sqlite3";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import { getDbConnection } from "./db";
import { getSessionContextFolders } from "./session-context-folder-store";

/**
 * The session cache lives alongside its own profile's data so profiles
 * don't share a single cache file. The default profile keeps
 * ~/.hermes/desktop/sessions.json; named profiles use
 * ~/.hermes/profiles/<name>/desktop/sessions.json (issue #311).
 */
function cacheFilePath(): string {
  return join(
    profileHome(getActiveProfileNameSync()),
    "desktop",
    "sessions.json",
  );
}

export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  /**
   * When the session was last USED — the newest message timestamp.
   *
   * Distinct from `startedAt`, which is when the session was OPENED. A session
   * begun in the morning and used all day reports the morning for startedAt, so
   * ordering by it makes "last updated" mean "last started", not "last used".
   * Falls back to `startedAt` when the session has no messages (or the DB has
   * no messages table yet), so it is never 0 for a real session.
   */
  lastActiveAt: number;
  source: string;
  messageCount: number;
  model: string;
  contextFolder?: string | null;
  contextFolders: string[];
  /** Set by the agent for subagent runs / branches; null for normal chats. */
  parentSessionId?: string | null;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
}

// Generate a short, readable title from the first user message (like ChatGPT/Claude)
function generateTitle(message: string): string {
  if (!message || !message.trim())
    return t("sessions.newConversation", getAppLocale());

  // Clean up the message
  let text = message.trim();

  // Remove markdown formatting
  text = text.replace(/[#*_`~[\]()]/g, "");
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Remove extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return t("sessions.newConversation", getAppLocale());

  // If short enough, use as-is
  if (text.length <= 50) return text;

  // Take first meaningful chunk — aim for ~40-50 chars at word boundary
  const words = text.split(" ");
  let title = "";
  for (const word of words) {
    if ((title + " " + word).trim().length > 45) break;
    title = (title + " " + word).trim();
  }

  return title || text.slice(0, 45) + "...";
}

function readCache(): CacheData {
  const file = cacheFilePath();
  try {
    if (!existsSync(file)) return { sessions: [], lastSync: 0 };
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as CacheData;
    type LegacySession = CachedSession & {
      contextFolder?: string | null;
    };
    return {
      lastSync: typeof parsed.lastSync === "number" ? parsed.lastSync : 0,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.map((s) => {
            const legacy = s as LegacySession;
            const folders = Array.isArray(s.contextFolders)
              ? s.contextFolders.filter(
                  (f): f is string => typeof f === "string",
                )
              : typeof legacy.contextFolder === "string" && legacy.contextFolder
                ? [legacy.contextFolder]
                : [];
            const folder = folders[0] ?? legacy.contextFolder ?? null;
            return {
              ...s,
              contextFolder: folder,
              contextFolders: folders,
            };
          })
        : [],
    };
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(cacheFilePath(), JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(): Database.Database | null {
  return getDbConnection(true);
}

// The sessions table has a self-referential FK parent_session_id (set by the
// agent for subagent runs / branches). Older state.db files lack the column —
// guard the SELECT and cache the answer after the first lookup.
let cacheHasParentColumn: boolean | null = null;
function hasParentSessionColumn(db: Database.Database): boolean {
  if (cacheHasParentColumn !== null) return cacheHasParentColumn;
  try {
    cacheHasParentColumn =
      db
        .prepare(
          "SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'parent_session_id'",
        )
        .get() != null;
  } catch {
    cacheHasParentColumn = false;
  }
  return cacheHasParentColumn;
}

/**
 * Normalize a message timestamp to epoch SECONDS.
 *
 * `messages.timestamp` is milliseconds in the schema this app reads from, but a
 * value that already looks like seconds must not be divided again (that would
 * shift it to 1970). The discriminator is magnitude: epoch seconds for any
 * modern date are ~1e9, milliseconds ~1e12 — a factor of 1000 apart, so the
 * boundary is unambiguous for every realistic timestamp.
 */
export function toEpochSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // 1e11 sec = year 5138, 1e11 ms = 1973 — so anything at/above 1e11 is ms.
  return value >= 1e11 ? Math.floor(value / 1000) : Math.floor(value);
}

/**
 * Newest message timestamp per session — the session's LAST ACTIVITY.
 *
 * One batched query rather than per-row reads (the same reasoning as
 * `attachContextFolders`). Guarded: a state.db without a `messages` table (or
 * without `timestamp`) yields an empty map, and callers fall back to
 * `startedAt` — so a schema surprise degrades the ordering signal instead of
 * breaking the sync.
 *
 * UNIT: returns SECONDS, matching `sessions.started_at`.
 *
 * The two tables disagree on units — `messages.timestamp` is epoch
 * MILLISECONDS (the renderer does `new Date(ms)` with no scaling) while
 * `sessions.started_at` is epoch SECONDS (`new Date(sec * 1000)`). Since
 * `lastActiveAt` is stored and compared beside `startedAt`, it must be in the
 * same unit: returning the raw millisecond value made it ~1000x larger than
 * every fallback value, so a session without messages (or on a schema that
 * never produced one) sorted arbitrarily against the rest.
 */
export function lastActivityBySession(
  db: Database.Database,
  ids: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  try {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT session_id, MAX(timestamp) AS last_at
           FROM messages
          WHERE session_id IN (${placeholders})
          GROUP BY session_id`,
      )
      .all(...ids) as Array<{ session_id: string; last_at: number | null }>;
    for (const row of rows) {
      if (typeof row.last_at === "number" && Number.isFinite(row.last_at)) {
        out.set(row.session_id, toEpochSeconds(row.last_at));
      }
    }
  } catch {
    // No messages table / no timestamp column — fall back to started_at.
  }
  return out;
}

// Attach each session's linked folder in a single batched store read, so a
// full sync stays a couple of queries rather than two per row. The result is
// written into the JSON cache by `syncSessionCache`, which lets the renderer's
// fast read path (`listCachedSessions`) stay DB-free.
function attachContextFolders(sessions: CachedSession[]): CachedSession[] {
  const folders = getSessionContextFolders(sessions.map((s) => s.id));
  return sessions.map((session) => {
    const list = folders.get(session.id) ?? [];
    const first = list[0] ?? session.contextFolder ?? null;
    return {
      ...session,
      contextFolder: first,
      contextFolders: list.length > 0 ? list : first ? [first] : [],
    };
  });
}

// Sync from hermes DB to local cache
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const db = getDb();
  if (!db) return cache.sessions;

  try {
    // Always fetch all sessions. The incremental lastSync-window approach
    // was missing sessions that were in the DB but not yet in the cache
    // (e.g. after a cache reset), permanently hiding them from the sidebar.
    // Full scans of even 1000+ rows are <5ms on better-sqlite3.
    const hasParent = hasParentSessionColumn(db);
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title${
          hasParent ? ", s.parent_session_id" : ""
        }
         FROM sessions s
         ORDER BY s.started_at DESC`,
      )
      .all() as Array<{
      id: string;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
      title: string | null;
      parent_session_id: string | null;
    }>;

    // Index existing sessions by id once so the per-row update below is
    // O(1) instead of O(N). Without this, syncing N existing sessions
    // against N new rows is O(N²) and visibly slows app startup once a
    // user has accumulated thousands of sessions (issue #16).
    const existingById = new Map<string, CachedSession>();
    for (const s of cache.sessions) existingById.set(s.id, s);
    const newSessions: CachedSession[] = [];

    const refreshedIds = new Set<string>();
    for (const row of rows) {
      refreshedIds.add(row.id);
      const existing = existingById.get(row.id);
      if (existing) {
        existing.messageCount = row.message_count;
        if (row.model) existing.model = row.model;
        if (row.title) existing.title = row.title;
        if (row.parent_session_id) {
          existing.parentSessionId = row.parent_session_id;
        }
        continue;
      }

      let title = row.title || "";
      if (!title) {
        try {
          const msg = db
            .prepare(
              `SELECT content FROM messages
               WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
               ORDER BY timestamp, id LIMIT 1`,
            )
            .get(row.id) as { content: string } | undefined;
          title = msg
            ? generateTitle(msg.content)
            : t("sessions.newConversation", getAppLocale());
        } catch {
          title = t("sessions.newConversation", getAppLocale());
        }
      }

      newSessions.push({
        id: row.id,
        title,
        startedAt: row.started_at,
        // Overwritten by the batched last-activity pass below; start time is the
        // correct fallback for a session with no messages yet.
        lastActiveAt: row.started_at,
        source: row.source,
        messageCount: row.message_count,
        model: row.model || "",
        parentSessionId: row.parent_session_id,
        // Filled in below by the single batched `attachContextFolders` pass
        // over the merged set, so we don't query the store once per new row.
        contextFolders: [],
      });
    }

    // Phase 2: refresh message_count for cached sessions that weren't
    // returned by the lastSync-windowed query above. Without this, an
    // old session that's still accumulating messages keeps the stale
    // count it had at first sync — the renderer reads from the cache,
    // so the UI reports e.g. 15 messages when the conversation actually
    // has 200+. Issue #226. Cheap (single column, no joins, batched IN
    // clause), and skipped entirely on a first sync since cache.sessions
    // is empty.
    const staleIds = cache.sessions
      .map((s) => s.id)
      .filter((id) => !refreshedIds.has(id));
    if (staleIds.length > 0) {
      // SQLite caps prepared-statement parameters; chunk well under
      // SQLITE_MAX_VARIABLE_NUMBER (default 999 on older builds) for
      // portability across the better-sqlite3 versions hermes ships.
      const CHUNK = 500;
      const countsById = new Map<string, number>();
      for (let i = 0; i < staleIds.length; i += CHUNK) {
        const chunk = staleIds.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const refreshed = db
          .prepare(
            `SELECT id, message_count FROM sessions WHERE id IN (${placeholders})`,
          )
          .all(...chunk) as Array<{ id: string; message_count: number }>;
        for (const r of refreshed) countsById.set(r.id, r.message_count);
      }
      cache.sessions = cache.sessions.filter(
        (s) => refreshedIds.has(s.id) || countsById.has(s.id),
      );
      for (const s of cache.sessions) {
        const fresh = countsById.get(s.id);
        if (fresh !== undefined && fresh !== s.messageCount) {
          s.messageCount = fresh;
        }
      }
    }

    // Merge via Map to prevent duplicates: existing sessions (already
    // mutated in-place above) plus newly discovered sessions.
    const merged = new Map<string, CachedSession>();
    for (const s of cache.sessions) merged.set(s.id, s);
    for (const s of newSessions) merged.set(s.id, s);
    const allSessions = attachContextFolders(Array.from(merged.values()));

    // Last activity: one batched MAX(timestamp) over the merged id set. A
    // session that is still accumulating messages keeps advancing, so this must
    // run on EVERY sync (not just for new rows) or a long session would freeze
    // at the activity time it had when first cached.
    const activity = lastActivityBySession(
      db,
      allSessions.map((s) => s.id),
    );
    for (const session of allSessions) {
      // Falls back to startedAt so the field is never 0/undefined for a real
      // session (an empty session has no messages to max over).
      session.lastActiveAt = activity.get(session.id) ?? session.startedAt;
    }

    // Sort by LAST ACTIVITY, not start: the sidebar's "last updated" ordering
    // reads the first entry of each project, and a session opened this morning
    // but used all day belongs near the top.
    allSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated);
    return updated.sessions;
  } catch {
    return cache.sessions;
  }
}

// Fast read from cache only (no DB access). `contextFolder` is persisted into
// the cache by `syncSessionCache`, and folder changes trigger a re-sync (the
// renderer fires `hermes-session-context-folder-changed`), so the cached value
// stays current without this path touching the DB.
export function listCachedSessions(limit = 50, offset = 0): CachedSession[] {
  const cache = readCache();
  return cache.sessions.slice(offset, offset + limit);
}

// Update title for a specific session
export function updateSessionTitle(sessionId: string, title: string): void {
  const cache = readCache();
  const idx = cache.sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    cache.sessions[idx].title = title;
    writeCache(cache);
  }
  // Also persist in state.db so the rename survives cache rebuilds
  try {
    const dbPath = activeStateDbPath();
    if (existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
          title,
          sessionId,
        );
      } finally {
        db.close();
      }
    }
  } catch {
    // ignore DB errors — cache update above is the fast path
  }
}

// Update context folders for a specific session in cache
export function updateSessionContextFoldersInCache(
  sessionId: string,
  folders: string[],
): void {
  const cache = readCache();
  const idx = cache.sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    cache.sessions[idx].contextFolders = folders;
    writeCache(cache);
  }
}

// Remove a session entry from the local cache. Called after the underlying
// row in state.db is deleted so the renderer's fast-path cache doesn't keep
// surfacing a session that no longer exists.
export function removeSessionFromCache(sessionId: string): void {
  const cache = readCache();
  const next = cache.sessions.filter((s) => s.id !== sessionId);
  if (next.length !== cache.sessions.length) {
    cache.sessions = next;
    writeCache(cache);
  }
}
