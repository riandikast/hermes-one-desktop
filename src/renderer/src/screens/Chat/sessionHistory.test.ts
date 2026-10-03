// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  dbItemsToChatMessages,
  dbTailShowsLiveTurnDone,
  hasPendingToolInTail,
  preserveLocalAssistantErrors,
  type DbHistoryItem,
} from "./sessionHistory";
import type { ChatMessage } from "./types";

// quiet-finalize is the recovery for a LOST `message.complete`. It reads
// state.db and must only end the turn when the answer is really persisted —
// ending early deletes the just-sent user message and resurrects the previous
// answer. Since the read is now cursor-scoped (only the un-reconciled tail),
// the guard decides from the tail plus the live transcript.
describe("dbTailShowsLiveTurnDone", () => {
  const user = (id: string, content: string): ChatMessage => ({
    id,
    role: "user",
    content,
  });
  const agent = (id: string, content: string): ChatMessage => ({
    id,
    role: "agent",
    content,
  });

  it("is false while the user row has not been persisted", () => {
    const live = [user("local-send-1", "hello")];
    expect(dbTailShowsLiveTurnDone(live, [])).toBe(false);
  });

  it("is false while the answer is still missing", () => {
    const live = [user("local-send-1", "hello")];
    const tail = [user("db-10", "hello")];
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(false);
  });

  it("is true once the tail carries the answer for the live turn", () => {
    const live = [user("local-send-1", "hello")];
    const tail = [user("db-10", "hello"), agent("db-11", "hi there")];
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(true);
  });

  it("is false when the tail's last user row is a DIFFERENT (next) message", () => {
    // The user typed the next message but it isn't the live turn's user row
    // yet — finalizing now would be premature.
    const live = [
      user("db-10", "hello"),
      agent("db-11", "answer"),
      user("local-send-2", "next"),
    ];
    const tail = [agent("db-11", "answer")];
    // live's last user (local-send-2) is not in the tail and has no db id, so
    // it is not caught up.
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(false);
  });

  it("ignores synthetic overlay rows (negative ids) in the tail", () => {
    const live = [user("local-send-1", "hello")];
    const tail = [
      { id: "db--5", role: "user", content: "continuation" } as ChatMessage,
      user("db-10", "hello"),
      agent("db-11", "answer"),
    ];
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(true);
  });

  it("treats an already-reconciled live user row as caught up", () => {
    const live = [user("db-10", "hello"), agent("db-11", "answer")];
    expect(dbTailShowsLiveTurnDone(live, [])).toBe(true);
  });

  // A model that writes interim text and then calls a tool is MID-TURN, not
  // done. Treating that as complete fired the finish chime and reset the
  // thinking/tool timers between the first response and the continued work.
  const toolCall = (id: string, callId: string): ChatMessage =>
    ({ id, kind: "tool_call", callId, name: "run_terminal" }) as ChatMessage;
  const toolResult = (id: string, callId: string): ChatMessage =>
    ({ id, kind: "tool_result", callId, content: "ok" }) as ChatMessage;

  it("is false while a tool is pending, even though interim text exists", () => {
    const live = [
      user("db-10", "hello"),
      agent("db-11", "let me check that"),
      toolCall("db-tc-12-c1", "c1"),
    ];
    const tail = [
      user("db-10", "hello"),
      agent("db-11", "let me check that"),
      toolCall("db-tc-12-c1", "c1"),
    ];
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(false);
  });

  it("is true once the pending tool has resolved", () => {
    const live = [
      user("db-10", "hello"),
      agent("db-11", "let me check that"),
      toolCall("db-tc-12-c1", "c1"),
      toolResult("db-tr-13", "c1"),
      agent("db-14", "here is the answer"),
    ];
    const tail = [...live];
    expect(dbTailShowsLiveTurnDone(live, tail)).toBe(true);
  });

  it("is false when the live transcript still has an unresolved tool", () => {
    // The live transcript is authoritative for liveness: even if the DB tail
    // looks settled, a pending tool means the turn is still running.
    const live = [
      user("db-10", "hello"),
      toolCall("db-tc-12-c1", "c1"),
      agent("db-13", "interim"),
    ];
    expect(dbTailShowsLiveTurnDone(live, [])).toBe(false);
  });
});

describe("hasPendingToolInTail", () => {
  const toolCall = (callId: string): ChatMessage =>
    ({ id: `db-tc-1-${callId}`, kind: "tool_call", callId }) as ChatMessage;
  const toolResult = (callId: string): ChatMessage =>
    ({ id: `db-tr-2-${callId}`, kind: "tool_result", callId }) as ChatMessage;

  it("is false for an empty slice or plain messages", () => {
    expect(hasPendingToolInTail([])).toBe(false);
    expect(
      hasPendingToolInTail([
        { id: "db-1", role: "user", content: "hi" } as ChatMessage,
      ]),
    ).toBe(false);
  });

  it("is true for a call with no matching result", () => {
    expect(hasPendingToolInTail([toolCall("c1")])).toBe(true);
  });

  it("is false when every call has a matching result", () => {
    expect(hasPendingToolInTail([toolCall("c1"), toolResult("c1")])).toBe(
      false,
    );
  });

  it("matches results by callId, not position", () => {
    // c1 resolves, c2 does not -> still pending.
    expect(
      hasPendingToolInTail([toolCall("c1"), toolCall("c2"), toolResult("c1")]),
    ).toBe(true);
    expect(
      hasPendingToolInTail([
        toolCall("c1"),
        toolCall("c2"),
        toolResult("c2"),
        toolResult("c1"),
      ]),
    ).toBe(false);
  });

  it("requires the result to come AFTER its call", () => {
    // A result before the call cannot resolve it.
    expect(hasPendingToolInTail([toolResult("c1"), toolCall("c1")])).toBe(true);
  });
});

describe("preserveLocalAssistantErrors", () => {
  it("uses linear ID reads when history has no local errors", () => {
    const count = 1000;
    let idReads = 0;
    const current: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
      get id() {
        idReads++;
        return `message-${i}`;
      },
      role: "agent",
      content: "answer",
    }));
    const next: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
      id: `message-${i}`,
      role: "agent",
      content: "answer",
    }));

    const output = preserveLocalAssistantErrors(next, current);

    expect(idReads).toBeLessThanOrEqual(count * 3);
    expect(output).not.toBe(next);
    output.forEach((message, i) => expect(message).toBe(next[i]));
  });

  it("uses the first local match even when duplicate IDs disagree on errors", () => {
    const first: ChatMessage = {
      id: "duplicate",
      role: "agent",
      content: "answer",
      error: "first error",
    };
    const later: ChatMessage = { ...first, error: "later error" };
    const next: ChatMessage = {
      id: "duplicate",
      role: "agent",
      content: "persisted answer",
      pending: true,
    };

    expect(preserveLocalAssistantErrors([next], [first, later])).toEqual([
      { ...next, error: "first error", pending: false },
    ]);
    expect(preserveLocalAssistantErrors([next], [next, first])[0]).toBe(next);
    expect(preserveLocalAssistantErrors([first], [later])[0]).toBe(first);
    expect(next.pending).toBe(true);
  });
});

const QUESTION = "How should I proceed?";

const clarifyArgs = JSON.stringify({
  questions: [{ choices: ["Option A", "Option B"], question: QUESTION }],
});

const clarifyResult = JSON.stringify({
  responses: [
    {
      choices_offered: ["Option A", "Option B"],
      question: QUESTION,
      user_response: "Option A",
    },
  ],
});

describe("dbItemsToChatMessages — persisted clarify calls", () => {
  it("renders a clarify tool call as a resolved card, not raw JSON", () => {
    const items: DbHistoryItem[] = [
      { kind: "user", id: 1, content: "go on" },
      {
        kind: "tool_call",
        id: 2,
        callId: "c1",
        name: "clarify",
        args: clarifyArgs,
      },
      {
        kind: "tool_result",
        id: 3,
        callId: "c1",
        name: "clarify",
        content: clarifyResult,
      },
    ];

    const messages = dbItemsToChatMessages(items);

    // The raw tool_call / tool_result rows are replaced by ONE card.
    expect(messages.some((m) => m.kind === "tool_call")).toBe(false);
    expect(messages.some((m) => m.kind === "tool_result")).toBe(false);

    const card = messages.find((m) => m.kind === "clarify");
    expect(card).toBeDefined();
    const clarify = card as Extract<
      (typeof messages)[number],
      { kind: "clarify" }
    >;
    expect(clarify.question).toBe(QUESTION);
    expect(clarify.choices).toEqual(["Option A", "Option B"]);
    // Replayed cards are historical — read-only, with the answer folded in.
    expect(clarify.resolved).toBe(true);
    expect(clarify.answer).toBe("Option A");
  });

  it("still renders the clarify card when unanswered", () => {
    const items: DbHistoryItem[] = [
      {
        kind: "tool_call",
        id: 5,
        callId: "c9",
        name: "clarify",
        args: clarifyArgs,
      },
    ];

    const messages = dbItemsToChatMessages(items);
    const clarify = messages.find((m) => m.kind === "clarify") as {
      question: string;
      answer?: string;
    };
    expect(clarify.question).toBe(QUESTION);
    expect(clarify.answer).toBeUndefined();
  });

  it("renders the legacy single-question shape", () => {
    const items: DbHistoryItem[] = [
      {
        kind: "tool_call",
        id: 7,
        callId: "c2",
        name: "clarify",
        args: JSON.stringify({ question: "Which env?", choices: ["staging"] }),
      },
      {
        kind: "tool_result",
        id: 8,
        callId: "c2",
        name: "clarify",
        content: "staging",
      },
    ];

    const messages = dbItemsToChatMessages(items);
    const clarify = messages.find((m) => m.kind === "clarify") as {
      question: string;
      answer?: string;
    };
    expect(clarify.question).toBe("Which env?");
    expect(clarify.answer).toBe("staging");
  });

  it("leaves non-clarify tool calls untouched", () => {
    const items: DbHistoryItem[] = [
      {
        kind: "tool_call",
        id: 9,
        callId: "c3",
        name: "terminal",
        args: '{"command":"ls"}',
      },
      {
        kind: "tool_result",
        id: 10,
        callId: "c3",
        name: "terminal",
        content: "ok",
      },
    ];

    const messages = dbItemsToChatMessages(items);
    expect(messages.map((m) => m.kind)).toEqual(["tool_call", "tool_result"]);
  });

  it("keeps plain user/assistant turns intact", () => {
    const items: DbHistoryItem[] = [
      { kind: "user", id: 11, content: "hi" },
      { kind: "assistant", id: 12, content: "hello" },
    ];

    const messages = dbItemsToChatMessages(items);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hi" });
    expect(messages[1]).toMatchObject({ role: "agent", content: "hello" });
  });
});
