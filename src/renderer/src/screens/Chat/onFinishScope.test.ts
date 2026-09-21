// @vitest-environment jsdom
//
// PER-SESSION On-Finish queues.
//
// The reported bug: the queue (and therefore arming, which is DERIVED from a
// non-empty queue) was global, so ticking commands in one chat silently armed
// every other chat. These assert the isolation that fixes it — and, just as
// importantly, that an upgrade does NOT lose an existing queue.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ON_FINISH_CHANGE_EVENT,
  ON_FINISH_DEFAULT_SCOPE,
  ON_FINISH_SELECTION_KEY,
  migrateOnFinishSelection,
  readAllOnFinishSelections,
  readOnFinishSelection,
  writeOnFinishSelection,
} from "./onFinish";

beforeEach(() => {
  localStorage.clear();
});

describe("per-session queue isolation", () => {
  it("keeps each session's queue separate", () => {
    writeOnFinishSelection(["build", "test"], "session-a");
    writeOnFinishSelection(["deploy"], "session-b");

    expect(readOnFinishSelection("session-a")).toEqual(["build", "test"]);
    expect(readOnFinishSelection("session-b")).toEqual(["deploy"]);
  });

  it("does not arm a session whose own queue is empty", () => {
    // The regression: session-b was reading session-a's queue and arming.
    writeOnFinishSelection(["build"], "session-a");
    expect(readOnFinishSelection("session-b")).toEqual([]);
  });

  it("preserves ORDER within a session", () => {
    writeOnFinishSelection(["zebra", "alpha", "mango"], "session-a");
    expect(readOnFinishSelection("session-a")).toEqual([
      "zebra",
      "alpha",
      "mango",
    ]);
  });

  it("treats an explicit empty queue as written, not as 'fall back'", () => {
    // Unticking everything must DISARM, not resurrect the legacy global queue.
    writeOnFinishSelection([], "session-a");
    expect(readOnFinishSelection("session-a")).toEqual([]);
  });

  it("tags the change event with the scope it was written for", () => {
    const seen: (string | undefined)[] = [];
    const listener = (e: Event): void => {
      seen.push((e as CustomEvent<{ scope?: string }>).detail?.scope);
    };
    window.addEventListener(ON_FINISH_CHANGE_EVENT, listener);
    writeOnFinishSelection(["x"], "session-a");
    window.removeEventListener(ON_FINISH_CHANGE_EVENT, listener);

    // The chat filters on this, so an unset scope would wake every chat.
    expect(seen).toEqual(["session-a"]);
  });
});

describe("legacy queue migration", () => {
  it("reads the old unscoped queue for the default scope", () => {
    // Pre-upgrade value, written with no scope at all.
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([{ id: "legacy", order: 0 }]),
    );
    expect(readOnFinishSelection(ON_FINISH_DEFAULT_SCOPE)).toEqual(["legacy"]);
  });

  it("does not leak the legacy queue into a named session", () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([{ id: "legacy", order: 0 }]),
    );
    // A named session must start clean; otherwise every chat inherits it.
    expect(readOnFinishSelection("session-a")).toEqual([]);
  });

  it("moves a draft queue onto the session id", () => {
    writeOnFinishSelection(["build"], "run-123");
    migrateOnFinishSelection("run-123", "session-a");

    expect(readOnFinishSelection("session-a")).toEqual(["build"]);
    // Source cleared, so it cannot be re-migrated onto another session.
    expect(readOnFinishSelection("run-123")).toEqual([]);
  });

  it("does NOT clobber a session that already has its own queue", () => {
    // Reopening an existing session must keep its saved queue.
    writeOnFinishSelection(["draft-cmd"], "run-123");
    writeOnFinishSelection(["real-cmd"], "session-a");
    migrateOnFinishSelection("run-123", "session-a");

    expect(readOnFinishSelection("session-a")).toEqual(["real-cmd"]);
  });

  it("is a no-op when migrating to itself", () => {
    writeOnFinishSelection(["build"], "same");
    migrateOnFinishSelection("same", "same");
    expect(readOnFinishSelection("same")).toEqual(["build"]);
  });
});

describe("commands page aggregate view", () => {
  it("unions ids across every session scope", () => {
    writeOnFinishSelection(["a", "b"], "session-a");
    writeOnFinishSelection(["b", "c"], "session-b");
    const all = readAllOnFinishSelections();
    expect([...all].sort()).toEqual(["a", "b", "c"]);
  });

  it("includes the legacy scope so old configs are still visible", () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([{ id: "legacy", order: 0 }]),
    );
    expect(readAllOnFinishSelections()).toContain("legacy");
  });

  it("ignores unrelated localstorage keys", () => {
    localStorage.setItem("hermes.unrelated", JSON.stringify(["nope"]));
    expect(readAllOnFinishSelections()).toEqual([]);
  });

  it("returns empty rather than throwing on corrupt scoped data", () => {
    localStorage.setItem(`${ON_FINISH_SELECTION_KEY}.session-a`, "{not json");
    expect(readOnFinishSelection("session-a")).toEqual([]);
    expect(() => readAllOnFinishSelections()).not.toThrow();
  });

  it("survives localStorage being unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => readAllOnFinishSelections()).not.toThrow();
    spy.mockRestore();
  });
});
