// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  migratePinnedMessages,
  pinnedMessagesKey,
  pinnedPreview,
  readPinnedMessages,
  writePinnedMessages,
} from "./pinnedMessages";

describe("pinned chat messages persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("namespaces the key per conversation identity", () => {
    expect(pinnedMessagesKey("sess-1")).toBe(
      "hermes.session.pinnedMessages.sess-1",
    );
    expect(pinnedMessagesKey("run-abc")).toBe(
      "hermes.session.pinnedMessages.run-abc",
    );
  });

  it("round-trips a pin so it survives a tab close / app restart", () => {
    writePinnedMessages("sess-1", [
      { id: "db-42", role: "agent", preview: "the answer" },
      { id: "db-41", role: "user", preview: "the question" },
    ]);

    // Fresh read, as if the chat remounted from storage.
    const pins = readPinnedMessages("sess-1");
    expect(pins).toHaveLength(2);
    expect(pins[0]).toEqual({
      id: "db-42",
      role: "agent",
      preview: "the answer",
    });
    expect(pins[1].role).toBe("user");
  });

  it("isolates pins between conversations", () => {
    writePinnedMessages("sess-1", [
      { id: "a", role: "user", preview: "one" },
    ]);
    writePinnedMessages("sess-2", [{ id: "b", role: "agent", preview: "two" }]);

    expect(readPinnedMessages("sess-1").map((p) => p.id)).toEqual(["a"]);
    expect(readPinnedMessages("sess-2").map((p) => p.id)).toEqual(["b"]);
  });

  it("clears storage when the last pin is removed", () => {
    writePinnedMessages("sess-1", [
      { id: "a", role: "user", preview: "one" },
    ]);
    writePinnedMessages("sess-1", []);
    expect(localStorage.getItem(pinnedMessagesKey("sess-1"))).toBeNull();
    expect(readPinnedMessages("sess-1")).toEqual([]);
  });

  it("moves a draft's pins onto the session id on first turn", () => {
    writePinnedMessages("run-draft", [
      { id: "a", role: "user", preview: "kept" },
    ]);
    migratePinnedMessages("run-draft", "sess-real");

    expect(readPinnedMessages("sess-real").map((p) => p.id)).toEqual(["a"]);
    expect(localStorage.getItem(pinnedMessagesKey("run-draft"))).toBeNull();
  });

  it("ignores malformed stored payloads instead of throwing", () => {
    localStorage.setItem(pinnedMessagesKey("sess-1"), "{not json");
    expect(readPinnedMessages("sess-1")).toEqual([]);

    localStorage.setItem(
      pinnedMessagesKey("sess-2"),
      JSON.stringify([{ id: 5 }, null, { id: "ok", role: "agent" }]),
    );
    expect(readPinnedMessages("sess-2").map((p) => p.id)).toEqual(["ok"]);
  });

  it("returns nothing for a missing identity", () => {
    expect(readPinnedMessages(null)).toEqual([]);
    expect(readPinnedMessages(undefined)).toEqual([]);
  });

  it("collapses whitespace and bounds the preview length", () => {
    expect(pinnedPreview("  a\n\n  b   c ")).toBe("a b c");
    const long = "x".repeat(400);
    const out = pinnedPreview(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });
});
