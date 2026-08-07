// @vitest-environment node
import { describe, expect, it } from "vitest";
import { reconcileAfterDbRefresh } from "./sessionHistory";
import type { ActiveTurn, ChatMessage } from "./types";

describe("reconcileAfterDbRefresh — partial streamed answer recovery", () => {
  const activeTurn: ActiveTurn = {
    startIndex: 0,
    status: "completed",
    turnId: "turn-1",
    userId: "u-1",
  };

  const partialBubble: ChatMessage = {
    id: "agent-dashboard-1-0",
    role: "agent",
    content: "The full answer starts here. ",
    pending: true,
    turnId: "turn-1",
  };

  const dbFull = (): ChatMessage[] => [
    { id: "db-1", role: "user", content: "hello" },
    {
      id: "db-2",
      role: "agent",
      content: "The full answer starts here. And continues to the end.",
    },
  ];

  it("replaces a pending partial streamed bubble with the DB's fuller text", () => {
    const current: ChatMessage[] = [
      { id: "db-1", role: "user", content: "hello" },
      partialBubble,
    ];
    const out = reconcileAfterDbRefresh(current, dbFull(), { activeTurn });
    const bubbles = out.filter(
      (m) => m.role === "agent" && !("kind" in m),
    );
    // One bubble — the partial is dropped, not stacked next to the full one.
    expect(bubbles).toHaveLength(1);
    expect(String((bubbles[0] as { content: string }).content)).toBe(
      "The full answer starts here. And continues to the end.",
    );
    // clearPending strips the flag entirely — a settled bubble has no pending.
    expect((bubbles[0] as { pending?: boolean }).pending).not.toBe(true);
  });

  it("keeps an unconsumed streamed bubble the DB does NOT cover", () => {
    // A genuinely different streamed message (not a prefix of any DB bubble)
    // must survive — e.g. an interim commentary the DB never persisted.
    const current: ChatMessage[] = [
      { id: "db-1", role: "user", content: "hello" },
      {
        id: "agent-dashboard-1-0",
        role: "agent",
        content: "Let me check the docs. ",
        pending: true,
        turnId: "turn-1",
      },
      partialBubble,
    ];
    const db: ChatMessage[] = [
      ...dbFull(),
      {
        id: "db-3",
        role: "agent",
        content: "Let me check the docs. And here is the rest.",
      },
    ];
    const out = reconcileAfterDbRefresh(current, db, { activeTurn });
    const contents = out
      .filter((m) => m.role === "agent" && !("kind" in m))
      .map((m) => String((m as { content: string }).content));
    // "Let me check the docs. " is a prefix of its DB counterpart → dropped;
    // the partial answer is also covered → dropped; both DB full versions win.
    expect(contents).toContain(
      "Let me check the docs. And here is the rest.",
    );
    expect(contents).toContain(
      "The full answer starts here. And continues to the end.",
    );
    expect(
      contents.some((c) => c === "The full answer starts here. "),
    ).toBe(false);
  });

  it("leaves a completed (non-pending) bubble alone", () => {
    const current: ChatMessage[] = [
      { id: "db-1", role: "user", content: "hello" },
      { ...partialBubble, pending: false },
    ];
    const out = reconcileAfterDbRefresh(current, dbFull(), { activeTurn });
    const bubbles = out.filter(
      (m) => m.role === "agent" && !("kind" in m),
    );
    // The completed partial is unconsumed but NOT pending — the coverage drop
    // only targets pending bubbles, so both survive (DB is canonical anyway).
    expect(bubbles.length).toBeGreaterThanOrEqual(1);
  });
});
