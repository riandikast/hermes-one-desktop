import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTurnActivity, resolveLeaseKey } from "./turn-activity";

vi.mock("./db", () => ({ getDbConnection: vi.fn(() => null) }));
vi.mock("./dashboard", () => ({ getManagedDashboardPids: vi.fn(() => []) }));

type Db = Parameters<typeof readTurnActivity>[0];

let db: DatabaseSync;

function leaseKey(holder: string, expiresAt: number, acquiredAt = expiresAt - 300): void {
  db.prepare(
    "INSERT INTO session_turn_leases (conversation_id, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run("session-a", holder, acquiredAt, expiresAt);
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT,
      end_reason TEXT
    );
    CREATE TABLE session_turn_leases (
      conversation_id TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      acquired_at REAL NOT NULL,
      expires_at REAL NOT NULL
    );
  `);
  db.prepare("INSERT INTO sessions (id, parent_session_id, end_reason) VALUES (?, ?, ?)").run(
    "session-a",
    null,
    null,
  );
});

afterEach(() => {
  db.close();
});

describe("readTurnActivity", () => {
  it("reports inactive when the session holds no lease", () => {
    expect(readTurnActivity(db as unknown as Db, "session-a")).toEqual({
      active: false,
      holderPid: null,
      holderAlive: null,
      platform: null,
      acquiredAt: null,
      expiresAt: null,
    });
  });

  it("reports a live foreign holder as active", () => {
    const now = Date.now();
    // This process is the only PID guaranteed live in a test run.
    leaseKey(`pid=${process.pid}:turn=t1:platform=cli`, now / 1000 + 240);
    const activity = readTurnActivity(db as unknown as Db, "session-a", now);
    expect(activity.active).toBe(true);
    expect(activity.holderPid).toBe(process.pid);
    expect(activity.holderAlive).toBe(true);
    expect(activity.platform).toBe("cli");
  });

  it("treats a dead holder as finished even while the row is unexpired", () => {
    const now = Date.now();
    leaseKey("pid=999999:turn=t1:platform=cli", now / 1000 + 240);
    const activity = readTurnActivity(db as unknown as Db, "session-a", now);
    expect(activity.holderAlive).toBe(false);
    expect(activity.active).toBe(false);
  });

  it("keeps a live holder active across a refresh gap just past expiry", () => {
    const now = Date.now();
    leaseKey(`pid=${process.pid}:turn=t1:platform=desktop`, now / 1000 - 30);
    expect(readTurnActivity(db as unknown as Db, "session-a", now).active).toBe(true);
  });

  it("falls back to the lease expiry when the holder names no pid", () => {
    const now = Date.now();
    leaseKey("turn=t1:platform=api", now / 1000 + 60);
    expect(readTurnActivity(db as unknown as Db, "session-a", now).active).toBe(true);
    expect(readTurnActivity(db as unknown as Db, "session-a", now + 120_000).active).toBe(false);
  });

  it("resolves the compression lineage root as the lease key", () => {
    db.prepare("INSERT INTO sessions (id, parent_session_id, end_reason) VALUES (?, ?, ?)").run(
      "session-root",
      null,
      "compression",
    );
    db.prepare("INSERT INTO sessions (id, parent_session_id, end_reason) VALUES (?, ?, ?)").run(
      "session-child",
      "session-root",
      null,
    );
    db.prepare(
      "INSERT INTO session_turn_leases (conversation_id, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run("session-root", `pid=${process.pid}:turn=t1:platform=desktop`, 0, Date.now() / 1000 + 120);

    expect(resolveLeaseKey(db as unknown as Db, "session-child")).toBe("session-root");
    expect(readTurnActivity(db as unknown as Db, "session-child").active).toBe(true);
  });
});
