/**
 * RED tests for the turn-completion UI-thread lock.
 *
 * Root cause (measured on the real session 20260815_004037_f049da, see
 * lat.md/_probe-root-cause.md):
 *   (a) the main process runs a FULL synchronous better-sqlite3 read of the
 *       whole session (21645 rows / 235 ms) on every completion, AND
 *   (b) the renderer rebuilds the whole transcript (28-29k messages / 782 ms,
 *       666 ms of it inside reconcileStreamedWithDb's O(n) text normalization).
 *
 * The fix must let the completion path read and reconcile only the rows NEWER
 * than the last id the renderer already holds, WITHOUT changing the reconcile
 * semantics (reconcileStreamedWithDb has 35 dedicated tests).
 *
 * These tests pin the two new seams. They must FAIL before the fix.
 */

import { describe, expect, it } from "vitest";
import {
  dbItemsToChatMessages,
  reconcileAfterDbRefresh,
  reconcileTailAfterDbRefresh,
  messageDbId,
  type DbHistoryItem,
} from "../src/renderer/src/screens/Chat/sessionHistory";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

const user = (id: number, content: string): DbHistoryItem => ({
  kind: "user",
  id,
  content,
});
const assistant = (id: number, content: string): DbHistoryItem => ({
  kind: "assistant",
  id,
  content,
});

describe("reconcileTailAfterDbRefresh", () => {
  it("produces the same transcript as a full reconcile when the prefix is unchanged", () => {
    // A long, already-canonical prefix plus a fresh tail turn.
    const prefixItems: DbHistoryItem[] = [];
    for (let i = 1; i <= 200; i++) {
      prefixItems.push(user(i * 2, `question ${i}`));
      prefixItems.push(assistant(i * 2 + 1, `answer ${i}`));
    }
    const livePrefix = dbItemsToChatMessages(prefixItems);
    const lastPrefixId = 401; // assistant(i=200) -> 200*2+1

    const tailItems: DbHistoryItem[] = [
      user(402, "final question"),
      assistant(403, "final answer"),
    ];

    // Current in-memory transcript = canonical prefix + the streamed tail turn.
    const current: ChatMessage[] = [
      ...livePrefix,
      { id: "streamed-u", role: "user", content: "final question" },
      { id: "streamed-a", role: "agent", content: "final answer", pending: true },
    ];

    const fullDb = dbItemsToChatMessages([...prefixItems, ...tailItems]);
    const expected = reconcileAfterDbRefresh(current, fullDb, {});

    const actual = reconcileTailAfterDbRefresh(current, dbItemsToChatMessages(tailItems), {
      lastSyncedDbId: lastPrefixId,
    });

    // Same rendered transcript: ids, order, and pending flag.
    expect(actual.map((m) => m.id)).toEqual(expected.map((m) => m.id));
    expect(actual.map((m) => ("kind" in m ? m.kind : m.role))).toEqual(
      expected.map((m) => ("kind" in m ? m.kind : m.role)),
    );
    expect(actual.map((m) => ("pending" in m ? !!m.pending : false))).toEqual(
      expected.map((m) => ("pending" in m ? !!m.pending : false)),
    );
  });

  it("keeps the untouched prefix by object identity (no O(transcript) rebuild)", () => {
    const prefixItems: DbHistoryItem[] = [];
    for (let i = 1; i <= 50; i++) {
      prefixItems.push(user(i * 2, `q${i}`));
      prefixItems.push(assistant(i * 2 + 1, `a${i}`));
    }
    const livePrefix = dbItemsToChatMessages(prefixItems);

    const current: ChatMessage[] = [
      ...livePrefix,
      { id: "streamed-u", role: "user", content: "new q" },
    ];
    const tail = dbItemsToChatMessages([user(200, "new q"), assistant(201, "new a")]);

    const out = reconcileTailAfterDbRefresh(current, tail, {
      lastSyncedDbId: 101,
    });

    // Every prefix message is carried over by reference, untouched.
    for (let i = 0; i < livePrefix.length; i++) {
      expect(out[i]).toBe(livePrefix[i]);
    }
    // ...and the tail turn was reconciled in after it.
    expect(out.length).toBeGreaterThan(livePrefix.length);
  });

  it("returns the full reconcile when the renderer holds no synced prefix yet", () => {
    const current: ChatMessage[] = [{ id: "u", role: "user", content: "hi" }];
    const tail = dbItemsToChatMessages([user(1, "hi"), assistant(2, "hello")]);

    const out = reconcileTailAfterDbRefresh(current, tail, { lastSyncedDbId: 0 });

    expect(out.map((m) => m.id)).toEqual(
      reconcileAfterDbRefresh(current, tail, {}).map((m) => m.id),
    );
  });

  it("keeps persisted synthetic (negative-id) overlays in the prefix, not duplicated", () => {
    // Session-continuation / local-error overlays are persisted with synthetic
    // NEGATIVE ids and re-prepended by the main process on EVERY read — even a
    // cursor-scoped tail read. They must stay in the prefix, exactly once.
    const items: DbHistoryItem[] = [
      { kind: "user", id: -900000000, content: "carried-over question" },
      { kind: "assistant", id: -900000001, content: "carried-over answer" },
      { kind: "user", id: 10, content: "new q" },
      { kind: "assistant", id: 11, content: "new a" },
    ];
    const mapped = dbItemsToChatMessages(items);
    const carriedOver = mapped.slice(0, 2);

    const current: ChatMessage[] = [
      ...carriedOver,
      { id: "streamed-u", role: "user", content: "new q" },
      { id: "streamed-a", role: "agent", content: "new a", pending: true },
    ];

    // The tail `db` includes the re-prepended overlays (mapped whole).
    const out = reconcileTailAfterDbRefresh(current, mapped, {
      lastSyncedDbId: 9,
    });

    const overlayRows = out.filter((m) => messageDbId(m) < 0);
    expect(overlayRows.map((m) => m.id)).toEqual([
      "db--900000000",
      "db--900000001",
    ]);
    // Overlays are the original objects, and the tail turn reconciled in.
    expect(out[0]).toBe(carriedOver[0]);
    expect(out[1]).toBe(carriedOver[1]);
    expect(out.find((m) => m.id === "streamed-a")).toBeTruthy();
  });

  it("enrolls real dbItemsToChatMessages ids (db-<n>) as the synced prefix", () => {
    // Guards against a silent fallback: with real `db-<n>` ids the tail path
    // must actually engage (a fallback would still be correct but slow).
    const prefixItems: DbHistoryItem[] = [];
    for (let i = 1; i <= 40; i++) {
      prefixItems.push(user(i * 2, `q${i}`));
      prefixItems.push(assistant(i * 2 + 1, `a${i}`));
    }
    const prefix = dbItemsToChatMessages(prefixItems);
    const boundary = 81; // last prefix id

    const current: ChatMessage[] = [
      ...prefix,
      { id: "streamed-u", role: "user", content: "next q" },
      { id: "streamed-a", role: "agent", content: "next a", pending: true },
    ];
    const tail = dbItemsToChatMessages([user(82, "next q"), assistant(83, "next a")]);

    const out = reconcileTailAfterDbRefresh(current, tail, {
      lastSyncedDbId: boundary,
    });
    // The full reconcile of the SAME live transcript, for the tail-region bar.
    // (It is not compared whole: on long transcripts it re-churns historical
    // duplicate-user rows, which is precisely what the tail path avoids.)
    const fullTailRegion = reconcileAfterDbRefresh(
      current.slice(prefix.length),
      tail,
      {},
    );

    // Prefix rows are the exact same objects; the tail matches the full merge.
    for (let i = 0; i < prefix.length; i++) expect(out[i]).toBe(prefix[i]);
    expect(out.slice(prefix.length).map((m) => m.id)).toEqual(
      fullTailRegion.map((m) => m.id),
    );
    expect(out.find((m) => m.id === "streamed-a")).toBeTruthy();
    expect(out.length).toBeGreaterThan(prefix.length);
  });
});
