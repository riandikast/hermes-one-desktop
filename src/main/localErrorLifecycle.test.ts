// @vitest-environment node
/**
 * A recorded turn failure must be RESOLVABLE once its turn succeeds.
 *
 * Reported: "HTTP 401 … Model mimo-v2.5-free is not supported" kept coming back
 * after the connection recovered.
 *
 * Mechanism: `persistSessionLocalError` INSERTs into
 * `desktop_session_local_errors`. `mergeSessionLocalErrors` re-attaches those
 * rows to the transcript on EVERY load. There was no delete path for one error,
 * so clearing the bubble in the renderer only hid it — the next refresh, or an
 * app restart, replayed the error for a turn that was now working.
 *
 * These tests exercise the store directly against a real sqlite connection, so
 * they pin the DB behaviour rather than a renderer copy of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal better-sqlite3-shaped handle is impractical here; the store only
// uses prepare().run/get/all, so an in-memory table double keeps the assertions
// honest about the SQL the store issues.
type Row = { id: number; session_id: string; user_content: string; error_text: string };

function makeDb(): {
  rows: Row[];
  exec: (sql: string) => void;
  prepare: (sql: string) => unknown;
} {
  const rows: Row[] = [];
  const tables = new Set<string>(["desktop_session_local_errors"]);
  let nextId = 1;
  return {
    rows,
    exec: (sql: string) => {
      // Only table DDL runs through exec here.
      const m = /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(sql.replace(/\s+/g, " "));
      if (m) tables.add(m[1]!);
      return undefined;
    },
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args: unknown[]) => {
          if (/^INSERT INTO desktop_session_local_errors/i.test(s)) {
            const [session_id, user_content, error_text] = args as string[];
            rows.push({ id: nextId++, session_id, user_content, error_text });
            return { changes: 1 };
          }
          if (/^DELETE FROM desktop_session_local_errors WHERE session_id = \? AND user_content = \?/i.test(s)) {
            const [session_id, user_content] = args as string[];
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (rows[i]!.session_id === session_id && rows[i]!.user_content === user_content) {
                rows.splice(i, 1);
              }
            }
            return { changes: 1 };
          }
          if (/^DELETE FROM desktop_session_local_errors WHERE session_id = \?/i.test(s)) {
            const [session_id] = args as string[];
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (rows[i]!.session_id === session_id) rows.splice(i, 1);
            }
            return { changes: 1 };
          }
          throw new Error(`unexpected run: ${s}`);
        },
        get: (...args: unknown[]) => {
          if (/^SELECT 1 FROM desktop_session_local_errors/i.test(s)) {
            const [session_id, user_content, error_text] = args as string[];
            return rows.find(
              (r) => r.session_id === session_id && r.user_content === user_content && r.error_text === error_text,
            );
          }
          if (/^SELECT name FROM sqlite_master/i.test(s)) {
            const [name] = args as string[];
            return tables.has(name) ? { name } : undefined;
          }
          throw new Error(`unexpected get: ${s}`);
        },
        all: (...args: unknown[]) => {
          if (/^SELECT id, user_content, error_text FROM desktop_session_local_errors/i.test(s)) {
            const [session_id] = args as string[];
            return rows.filter((r) => r.session_id === session_id).sort((a, b) => a.id - b.id);
          }
          throw new Error(`unexpected all: ${s}`);
        },
      };
    },
  };
}

const MODEL_401 =
  'HTTP 401: [401]: {"type":"error","error":{"type":"ModelError","message":"Model mimo-v2.5-free is not supported"}}';

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  db = makeDb();
  // The store resolves its connection internally; point that module at ours.
  vi.doMock("./db", () => ({ getDbConnection: () => db }));
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("desktop_session_local_errors lifecycle", () => {
  it("persists a failure and reads it back (the row that gets replayed)", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", MODEL_401, "hello");
    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toEqual([
      { userContent: "hello", error: MODEL_401 },
    ]);
  });

  it("RESOLVES the failure once the prompt succeeds, so it stops replaying", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", MODEL_401, "hello");
    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toHaveLength(1);

    // The turn succeeds on retry.
    store.resolveSessionLocalErrorsForPrompt("sess-1", "hello");

    // THE BUG: before the fix this row survived, and the load/merge below put
    // the 401 back into the transcript on the next refresh.
    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toEqual([]);

    const merged = store.mergeSessionLocalErrors(
      [{ kind: "message", id: 1, role: "user", content: "hello" }] as never,
      store.loadSessionLocalErrors(db as never, "sess-1"),
      { appendUnmatched: true },
    );
    const replayed = (merged as Array<{ error?: string }>).some(
      (m) => m.error === MODEL_401,
    );
    expect(replayed).toBe(false);
  });

  it("resolves by prompt, so a later DIFFERENT failure still clears", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", "old error text", "hello");
    // The retry fails differently, then is fixed. The prompt is healthy now.
    store.resolveSessionLocalErrorsForPrompt("sess-1", "hello");
    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toEqual([]);
  });

  it("only clears the prompt that succeeded, not other failed turns", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", "err A", "prompt A");
    store.persistSessionLocalError("sess-1", "err B", "prompt B");

    store.resolveSessionLocalErrorsForPrompt("sess-1", "prompt A");

    const left = store.loadSessionLocalErrors(db as never, "sess-1");
    expect(left).toEqual([{ userContent: "prompt B", error: "err B" }]);
  });

  it("does not leak across sessions", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", "err A", "same prompt");
    store.persistSessionLocalError("sess-2", "err B", "same prompt");

    store.resolveSessionLocalErrorsForPrompt("sess-1", "same prompt");

    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toEqual([]);
    expect(store.loadSessionLocalErrors(db as never, "sess-2")).toEqual([
      { userContent: "same prompt", error: "err B" },
    ]);
  });

  it("clearSessionLocalErrors drops every recorded failure for a session", async () => {
    const store = await import("./session-continuation-store");

    store.persistSessionLocalError("sess-1", "err A", "A");
    store.persistSessionLocalError("sess-1", "err B", "B");
    store.clearSessionLocalErrors("sess-1");
    expect(store.loadSessionLocalErrors(db as never, "sess-1")).toEqual([]);
  });
});
