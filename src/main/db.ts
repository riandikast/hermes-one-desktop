import Database from "better-sqlite3";
import { existsSync } from "fs";
import { activeStateDbPath } from "./utils";

let cachedReadDb: Database.Database | null = null;
let cachedReadPath: string | null = null;
let cachedWriteDb: Database.Database | null = null;
let cachedWritePath: string | null = null;

/**
 * Return a cached database connection for the active profile state DB.
 *
 * Two connections are kept: one read-only and one read-write. The agent CLI
 * keeps the DB open (WAL mode); opening a second read-write connection from
 * the desktop while the agent is writing can hit SQLITE_BUSY / lock
 * contention. Reads therefore use the read-only connection (no lock conflict),
 * and only genuine writes use the read-write one. Both are cached by path so
 * switching between read and write never closes and reopens the DB file (the
 * original bug that caused session reads to fail).
 */
export function getDbConnection(readonly = true): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) {
    closeDbConnection();
    return null;
  }

  if (readonly) {
    if (cachedReadDb && cachedReadPath === dbPath) return cachedReadDb;
    try {
      cachedReadDb = new Database(dbPath, { readonly: true });
      cachedReadPath = dbPath;
      return cachedReadDb;
    } catch (err) {
      console.error(`[db] Failed to open readonly database at ${dbPath}:`, err);
      return null;
    }
  }

  if (cachedWriteDb && cachedWritePath === dbPath) return cachedWriteDb;
  try {
    cachedWriteDb = new Database(dbPath);
    cachedWritePath = dbPath;
    return cachedWriteDb;
  } catch (err) {
    console.error(`[db] Failed to open writable database at ${dbPath}:`, err);
    return null;
  }
}

/**
 * Close the cached database connections if open.
 */
export function closeDbConnection(): void {
  for (const [db, setNull] of [
    [cachedReadDb, () => (cachedReadDb = null)],
    [cachedWriteDb, () => (cachedWriteDb = null)],
  ] as Array<[Database.Database | null, () => void]>) {
    if (db) {
      try {
        db.close();
      } catch (err) {
        console.error("[db] Error closing database connection:", err);
      }
    }
    setNull();
  }
  cachedReadPath = null;
  cachedWritePath = null;
}
