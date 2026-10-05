// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Database } from "better-sqlite3";
import { lastActivityBySession } from "./session-cache";

/**
 * `lastActivityBySession` turns a session's column-based `started_at` into a
 * real "when was this last USED" signal — the fix for a project sitting on top
 * because its session was merely OPENED recently.
 *
 * No real SQLite handle here: better-sqlite3 is a native module built for
 * Electron's Node ABI and cannot load in the test runner. The function only
 * needs `prepare(...).all(...)`, so a recorded stub verifies the parts that are
 * ours — the SQL it builds and how it folds the rows.
 */

interface StubRow {
  session_id: string;
  last_at: number | null;
}

/** A db whose `prepare().all()` returns `rows`, recording the SQL and params. */
function stubDb(rows: StubRow[]): {
  db: Database;
  sql: () => string;
  params: () => unknown[];
} {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const db = {
    prepare(sql: string) {
      capturedSql = sql;
      return {
        all: (...params: unknown[]) => {
          capturedParams = params;
          return rows;
        },
      };
    },
  } as unknown as Database;
  return { db, sql: () => capturedSql, params: () => capturedParams };
}

/** A db whose query throws, modelling a missing messages table. */
function throwingDb(): Database {
  return {
    prepare() {
      throw new Error("no such table: messages");
    },
  } as unknown as Database;
}

describe("lastActivityBySession", () => {
  it("maps session_id to its newest timestamp", () => {
    const { db } = stubDb([
      { session_id: "s1", last_at: 900 },
      { session_id: "s2", last_at: 250 },
    ]);
    const map = lastActivityBySession(db, ["s1", "s2"]);
    expect(map.get("s1")).toBe(900);
    expect(map.get("s2")).toBe(250);
  });

  it("asks the DB for MAX(timestamp) grouped per session", () => {
    // The whole point: the newest MESSAGE time, not the session's start column.
    const { db, sql } = stubDb([]);
    lastActivityBySession(db, ["s1"]);
    expect(sql()).toMatch(/MAX\(\s*timestamp\s*\)/i);
    expect(sql()).toMatch(/GROUP BY\s+session_id/i);
    expect(sql()).toMatch(/FROM\s+messages/i);
  });

  it("binds one placeholder per id, in order", () => {
    const { db, sql, params } = stubDb([]);
    lastActivityBySession(db, ["a", "b", "c"]);
    expect(sql()).toContain("?,?,?");
    expect(params()).toEqual(["a", "b", "c"]);
  });

  it("omits a session with no messages (caller falls back to startedAt)", () => {
    // A 0 here would sort the session to the bottom and read as "ancient"
    // rather than "never used" — leaving it out lets the caller decide.
    const { db } = stubDb([{ session_id: "s1", last_at: 100 }]);
    const map = lastActivityBySession(db, ["s1", "empty"]);
    expect(map.has("s1")).toBe(true);
    expect(map.has("empty")).toBe(false);
  });

  it("drops a NULL timestamp", () => {
    const { db } = stubDb([{ session_id: "s1", last_at: null }]);
    expect(lastActivityBySession(db, ["s1"]).has("s1")).toBe(false);
  });

  it("drops a non-finite timestamp", () => {
    const { db } = stubDb([
      { session_id: "s1", last_at: Number.NaN },
      { session_id: "s2", last_at: Number.POSITIVE_INFINITY },
    ]);
    expect(lastActivityBySession(db, ["s1", "s2"]).size).toBe(0);
  });

  it("returns an empty map for an empty id list without querying", () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as Database;
    expect(lastActivityBySession(db, []).size).toBe(0);
    // No point issuing `IN ()`.
    expect(prepare).not.toHaveBeenCalled();
  });

  it("degrades to an empty map when the query throws", () => {
    // A missing messages table / an old schema must not break the cache sync —
    // the caller then falls back to startedAt.
    expect(() => lastActivityBySession(throwingDb(), ["s1"])).not.toThrow();
    expect(lastActivityBySession(throwingDb(), ["s1"]).size).toBe(0);
  });

  it("handles a large id set without dropping any", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `s${i}`);
    const { db, sql } = stubDb(
      ids.map((id, i) => ({ session_id: id, last_at: i })),
    );
    const map = lastActivityBySession(db, ids);
    expect(map.size).toBe(200);
    expect(map.get("s199")).toBe(199);
    expect(sql()).toContain("?,".repeat(199) + "?");
  });
});
