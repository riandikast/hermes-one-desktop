// Paging arithmetic for opening a long session on its newest page.
//
// A full-history read measured ~450-560 ms of blocking SQLite and ~14 MB across
// IPC on a 28,896-row session, and the renderer then re-converted and
// re-grouped every row. The page query is what makes opening O(page) instead of
// O(history), so the cursor and LIMIT arithmetic is pinned here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_PAGE,
  buildSessionMessagesBeforeQuery,
  buildSessionMessagesQuery,
} from "./sessions";

/**
 * Every placeholder in the SQL must have a binding in `params`, in order.
 * A builder that returns fewer params than `?` placeholders makes every read
 * throw `RangeError: Too few parameter values were provided` — the bug that
 * made sessions unopenable. Asserting the counts here (not just the values)
 * is what catches a dropped binding.
 */
function placeholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

describe("buildSessionMessagesBeforeQuery", () => {
  it("binds every placeholder including session_id", () => {
    for (const [cursor, limit] of [
      [0, 200],
      [5000, 120],
      [0, 10.9],
      [-1, 50],
      [Number.NaN, 50],
    ] as const) {
      const q = buildSessionMessagesBeforeQuery("sess-1", cursor, limit);
      expect(q.params.length).toBe(placeholders(q.sql));
      expect(q.params).toContain("sess-1");
    }
  });

  it("takes the newest page when there is no cursor", () => {
    const q = buildSessionMessagesBeforeQuery("sess-1", 0, 200);
    // Newest-first LIMIT, then re-ordered chronologically for the renderer.
    expect(q.sql).toContain("ORDER BY m.id DESC");
    expect(q.sql).toContain("LIMIT ?");
    expect(q.sql.trimEnd().endsWith("ORDER BY timestamp, id")).toBe(true);
    // No cursor predicate when starting from the newest row.
    expect(q.sql).not.toContain("m.id < ?");
    expect(q.params).toEqual(["sess-1", 200]);
  });

  it("scopes to rows strictly older than the cursor", () => {
    const q = buildSessionMessagesBeforeQuery("sess-1", 5000, 120);
    expect(q.sql).toContain("m.id < ?");
    // Cursor, then session id, then the limit — the placeholder order in the SQL.
    expect(q.params).toEqual([5000, "sess-1", 120]);
  });

  it("falls back to the default page size for a non-positive limit", () => {
    expect(buildSessionMessagesBeforeQuery("s", 0, 0).params).toEqual([
      "s",
      DEFAULT_HISTORY_PAGE,
    ]);
    expect(buildSessionMessagesBeforeQuery("s", 0, -5).params).toEqual([
      "s",
      DEFAULT_HISTORY_PAGE,
    ]);
  });

  it("treats a non-positive cursor as no cursor", () => {
    for (const cursor of [0, -1, Number.NaN]) {
      const q = buildSessionMessagesBeforeQuery("s", cursor, 50);
      expect(q.sql).not.toContain("id < ?");
      expect(q.params).toEqual(["s", 50]);
    }
  });

  it("floors a fractional limit so LIMIT stays an integer", () => {
    expect(buildSessionMessagesBeforeQuery("s", 0, 10.9).params).toEqual([
      "s",
      10,
    ]);
  });
});

describe("buildSessionMessagesQuery (forward cursor)", () => {
  it("binds every placeholder including session_id", () => {
    for (const afterId of [0, 900, -1, Number.NaN]) {
      const q = buildSessionMessagesQuery("sess-1", afterId);
      expect(q.params.length).toBe(placeholders(q.sql));
      expect(q.params).toContain("sess-1");
    }
  });

  it("still reads the whole session when there is no cursor", () => {
    const q = buildSessionMessagesQuery("sess-1", 0);
    expect(q.sql).not.toContain("m.id > ?");
    expect(q.params).toEqual(["sess-1"]);
  });

  it("scopes to newer rows when given a cursor", () => {
    const q = buildSessionMessagesQuery("sess-1", 900);
    expect(q.sql).toContain("m.id > ?");
    expect(q.params).toEqual([900, "sess-1"]);
  });
});

// A compacted session stores several GENERATIONS of the same logical message
// (each in-place compaction clones the protected tail with a fresh id, active=0,
// compacted=1). Reading every generation rendered ~4.6x the logical rows as
// repeated bubbles (measured: 28,896 rows / 6,297 messages on the largest
// session). The backend's own reader filters hidden rows and collapses
// generations; both builders must do the same or the extra rows re-render.
describe("compaction visibility + generation dedupe", () => {
  for (const build of [
    (sid: string) => buildSessionMessagesQuery(sid, 0),
    (sid: string) => buildSessionMessagesBeforeQuery(sid, 0, 200),
  ]) {
    it("filters hidden rows (active = 1 OR compacted = 1)", () => {
      expect(build("s").sql).toContain("(m.active = 1 OR m.compacted = 1)");
    });

    it("keeps only the newest copy of each logical message", () => {
      const sql = build("s").sql;
      // Correlated NOT EXISTS keyed on the same columns as the backend's
      // display identity, so an older generation copy is dropped.
      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain("n.id > m.id");
      expect(sql).toContain("n.session_id = m.session_id");
      expect(sql).toContain("n.role = m.role");
      expect(sql).toContain("n.content IS m.content");
      expect(sql).toContain("n.timestamp = m.timestamp");
    });
  }
});
