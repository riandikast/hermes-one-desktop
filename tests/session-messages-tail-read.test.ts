/**
 * RED tests for the id-scoped tail read in the Electron MAIN process.
 *
 * Root cause (measured, see lat.md/_probe-root-cause.md): at turn completion
 * `getSessionMessages` runs a FULL synchronous better-sqlite3 SELECT for the
 * whole session — 21645 rows / 21305306 content bytes / 235 ms on the real
 * session 20260815_004037_f049da — and blocks the main process (and therefore
 * every window + all IPC) for that time. The same session read with an
 * `id > ?` bound is 0.0 ms when nothing is new.
 *
 * These pin the pure SQL builder so the behaviour is tested without the
 * Electron-only native module.
 */

import { describe, expect, it } from "vitest";
import { buildSessionMessagesQuery } from "../src/main/sessions";

describe("buildSessionMessagesQuery", () => {
  it("returns the full-history SQL with no id bound", () => {
    const q = buildSessionMessagesQuery();
    expect(q.sql).toContain("FROM messages");
    expect(q.sql).toContain("session_id = ?");
    expect(q.sql).toContain("role IN ('user', 'assistant', 'tool')");
    expect(q.sql).toContain("ORDER BY timestamp, id");
    expect(q.sql).not.toContain("id > ?");
    expect(q.params).toEqual([]);
  });

  it("scopes the read to rows newer than a known id", () => {
    const q = buildSessionMessagesQuery(58268);
    expect(q.sql).toContain("id > ?");
    expect(q.params).toEqual([58268]);
    // The id bound must not disturb the canonical ordering.
    expect(q.sql).toContain("ORDER BY timestamp, id");
    // Bound precedes the session id in the parameter list the caller binds.
    expect(q.sql.indexOf("id > ?")).toBeLessThan(q.sql.indexOf("session_id = ?"));
  });

  it("treats a zero / negative cursor as a full read", () => {
    expect(buildSessionMessagesQuery(0).params).toEqual([]);
    expect(buildSessionMessagesQuery(-1).params).toEqual([]);
    expect(buildSessionMessagesQuery(0).sql).not.toContain("id > ?");
  });
});
