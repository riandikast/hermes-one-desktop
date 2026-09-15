// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  dbItemsToChatMessages,
  preserveLocalAssistantErrors,
  type DbHistoryItem,
} from "./sessionHistory";
import type { ChatMessage } from "./types";

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
      { kind: "tool_call", id: 2, callId: "c1", name: "clarify", args: clarifyArgs },
      { kind: "tool_result", id: 3, callId: "c1", name: "clarify", content: clarifyResult },
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
      { kind: "tool_call", id: 5, callId: "c9", name: "clarify", args: clarifyArgs },
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
      { kind: "tool_result", id: 10, callId: "c3", name: "terminal", content: "ok" },
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
