// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("../src/main/db", () => ({ getDbConnection: () => state.db }));

import {
  deleteSessionContinuationForSession,
  loadSessionFileChanges,
  persistSessionFileChanges,
} from "../src/main/session-continuation-store";
import { getSessionMessages, getSessionMessagesBefore, type HistoryItem } from "../src/main/sessions";

let sqlite: DatabaseSync;
const change = (before = "old", after = "new"): { path: string; before: string; after: string } => ({ path: "C:/repo/a.txt", before, after });
const snapshots = (items: HistoryItem[]): HistoryItem[] => items.filter((item) => "fileChanges" in item);

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  state.db = Object.assign(sqlite, {
    transaction: (fn: () => void) => () => {
      sqlite.exec("BEGIN");
      try { fn(); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  }) as unknown as Database.Database;
  sqlite.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL,
    tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, reasoning TEXT,
    reasoning_content TEXT, reasoning_details TEXT, active INTEGER DEFAULT 1, compacted INTEGER DEFAULT 0
  )`);
  const insert = sqlite.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)");
  for (const [id, role, content] of [
    [1, "user", "same prompt"], [2, "assistant", "first answer"],
    [3, "user", "same prompt"], [4, "assistant", "second answer"],
    [5, "user", "no edits"], [6, "assistant", "nothing changed"],
  ] as const) insert.run(id, "session-a", role, content, id);
  insert.run(10, "session-b", "user", "same prompt", 10);
  insert.run(11, "session-b", "assistant", "other answer", 11);
});

afterEach(() => { sqlite.close(); state.db = null; });

describe("prompt-owned file-change archive", () => {
  it("retains two identical editing prompts across a later no-edit prompt and merges only the same owner", () => {
    expect(persistSessionFileChanges("session-a", [change()], 1)).toBe(true);
    expect(persistSessionFileChanges("session-a", [change("new", "second prompt result")], 3)).toBe(true);
    expect(persistSessionFileChanges("session-a", [
      { path: "c:\\repo\\A.txt", before: "new", after: "continued" },
      { path: "created.txt", before: null, beforeKnown: true, after: "created" },
    ], 1)).toBe(true);
    expect(persistSessionFileChanges("session-a", [
      { path: "created.txt", before: "created", after: "updated" },
    ], 1)).toBe(true);
    expect(persistSessionFileChanges("session-a", [], 5)).toBe(false);

    const reopened = getSessionMessages("session-a");
    expect(snapshots(reopened)).toEqual([
      expect.objectContaining({ kind: "user", id: 1, fileChanges: [
        expect.objectContaining({ path: "C:/repo/a.txt", before: "old", after: "continued" }),
        expect.objectContaining({ path: "created.txt", before: null, beforeKnown: true, after: "updated" }),
      ] }),
      expect.objectContaining({ kind: "user", id: 3, fileChanges: [change("new", "second prompt result")] }),
    ]);
    expect(reopened.find((item) => item.id === 5)).not.toHaveProperty("fileChanges");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM desktop_prompt_file_changes").get()).toEqual({ count: 2 });
  });

  it("attaches only on the owner page when prompts and answers are split across page boundaries", () => {
    persistSessionFileChanges("session-a", [change()], 1);
    persistSessionFileChanges("session-a", [change("new", "third")], 3);
    let cursor = 0;
    const pages: HistoryItem[][] = [];
    do {
      const page = getSessionMessagesBefore("session-a", cursor, 1);
      expect(page.items).toHaveLength(1);
      const [item] = page.items;
      expect("fileChanges" in item).toBe(item.id === 1 || item.id === 3);
      pages.unshift(page.items);
      cursor = page.hasMore ? page.oldestId! : 0;
    } while (cursor);
    expect(pages.flat()).toEqual(getSessionMessages("session-a"));
    expect(snapshots(getSessionMessages("session-a", 3))).toEqual([]);
  });

  it("keeps page snapshot reads bounded to present owner rows without SQL variable limits", () => {
    persistSessionFileChanges("session-a", [change()], 1);
    persistSessionFileChanges("session-a", [change("new", "third")], 3);
    expect([...loadSessionFileChanges(state.db!, "session-a", [3]).keys()]).toEqual([3]);
    expect(loadSessionFileChanges(state.db!, "session-a", []).size).toBe(0);
    expect([...loadSessionFileChanges(state.db!, "session-a", Array.from({ length: 40_000 }, (_, i) => i + 1)).keys()]).toEqual([1, 3]);
  });

  it("rejects missing, nonnumeric, nonexistent, non-user and cross-session owners without altering stored data", () => {
    persistSessionFileChanges("session-a", [change()], 1);
    for (const owner of [undefined, null, "1", 0, -1, 1.5, NaN, Infinity, 999, 2, 10]) {
      expect(persistSessionFileChanges("session-a", [change("bad", "bad")], owner as number)).toBe(false);
    }
    expect(loadSessionFileChanges(state.db!, "session-a").get(1)).toEqual([change()]);
    expect(loadSessionFileChanges(state.db!, "session-b").size).toBe(0);
    expect(persistSessionFileChanges("session-b", [change("other", "other result")], 10)).toBe(true);
    expect(snapshots(getSessionMessages("session-b"))).toEqual([
      expect.objectContaining({ id: 10, fileChanges: [change("other", "other result")] }),
    ]);
    expect(loadSessionFileChanges(state.db!, "session-a").get(1)).toEqual([change()]);
  });

  it("keeps legacy unowned overlays quarantined before and after creating the additive archive", () => {
    sqlite.exec("CREATE TABLE desktop_session_file_changes (session_id TEXT PRIMARY KEY, changes_json TEXT, updated_at REAL)");
    const legacy = JSON.stringify([change("legacy", "unowned")]);
    sqlite.prepare("INSERT INTO desktop_session_file_changes VALUES (?, ?, 1)").run("session-a", legacy);
    expect(loadSessionFileChanges(state.db!, "session-a").size).toBe(0);
    expect(snapshots(getSessionMessages("session-a"))).toEqual([]);
    expect(persistSessionFileChanges("session-a", [change()])).toBe(false);
    expect(persistSessionFileChanges("session-a", [change()], 3)).toBe(true);
    expect([...loadSessionFileChanges(state.db!, "session-a").keys()]).toEqual([3]);
    expect(snapshots(getSessionMessages("session-a"))).toEqual([
      expect.objectContaining({ kind: "user", id: 3, fileChanges: [change()] }),
    ]);
    expect(sqlite.prepare("SELECT changes_json FROM desktop_session_file_changes").get()).toEqual({ changes_json: legacy });
  });

  it("normalizes untrusted snapshots, skips corrupt data and never loads a deleted owner", () => {
    expect(persistSessionFileChanges("session-a", [null, {}, { path: "\0bad" }], 1)).toBe(false);
    expect(persistSessionFileChanges("session-a", [{ path: "path-only", before: 42, added: ["line", 42] }], 1)).toBe(true);
    expect(loadSessionFileChanges(state.db!, "session-a").get(1)).toEqual([
      { path: "path-only", before: null, after: null, added: ["line"] },
    ]);
    sqlite.exec("UPDATE desktop_prompt_file_changes SET changes_json = '{broken'");
    expect(snapshots(getSessionMessages("session-a"))).toEqual([]);
    persistSessionFileChanges("session-a", [change()], 1);
    sqlite.exec("DELETE FROM messages WHERE id = 1");
    expect(loadSessionFileChanges(state.db!, "session-a").size).toBe(0);
  });

  it("deletes only the selected session archive", () => {
    persistSessionFileChanges("session-a", [change()], 1);
    persistSessionFileChanges("session-b", [change("other", "other result")], 10);
    deleteSessionContinuationForSession(state.db!, "session-a");
    expect(loadSessionFileChanges(state.db!, "session-a").size).toBe(0);
    expect(loadSessionFileChanges(state.db!, "session-b").get(10)).toEqual([change("other", "other result")]);
  });
});
