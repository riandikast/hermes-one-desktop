import Database from "better-sqlite3";
import { existsSync } from "fs";
import { activeStateDbPath } from "./utils";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

/**
 * Return a cached database connection for the active profile state DB.
 * If the active profile database path or readonly status changes,
 * the old database connection is cleanly closed and a new one is established.
 */
export function getDbConnection(_readonly = true): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) {
    closeDbConnection();
    return null;
  }

  // Reuse the existing cached connection if the database path matches.
  // A single read-write connection handles both reads and writes cleanly
  // without closing/re-opening the database file.
  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  closeDbConnection();

  try {
    cachedDb = new Database(dbPath);
    cachedDbPath = dbPath;
    return cachedDb;
  } catch (err) {
    console.error(`[db] Failed to open database at ${dbPath}:`, err);
    return null;
  }
}

/**
 * Close the cached database connection if open.
 */
export function closeDbConnection(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      console.error("[db] Error closing database connection:", err);
    }
    cachedDb = null;
    cachedDbPath = null;
  }
}
