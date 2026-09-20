import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  findChatMatches,
  messageSearchText,
  stepMatchIndex,
} from "./chatTextSearch";
import type { ChatMessage } from "./types";

const user = (id: string, content: string): ChatMessage =>
  ({ id, role: "user", content }) as ChatMessage;
const agent = (id: string, content: string): ChatMessage =>
  ({ id, role: "agent", content }) as ChatMessage;
const reasoning = (id: string, text: string): ChatMessage =>
  ({ id, kind: "reasoning", role: "agent", text }) as ChatMessage;
const toolCall = (id: string, name: string, args: string): ChatMessage =>
  ({ id, kind: "tool_call", role: "agent", callId: id, name, args }) as ChatMessage;
const toolResult = (id: string, content: string): ChatMessage =>
  ({
    id,
    kind: "tool_result",
    role: "agent",
    callId: id,
    name: "terminal",
    content,
  }) as ChatMessage;

describe("messageSearchText", () => {
  it("reads bubbles, reasoning, tool rows and clarify questions", () => {
    expect(messageSearchText(user("u1", "hello world"))).toBe("hello world");
    expect(messageSearchText(agent("a1", "answer text"))).toBe("answer text");
    expect(messageSearchText(reasoning("r1", "thinking hard"))).toBe("thinking hard");
    expect(messageSearchText(toolCall("t1", "terminal", "echo hi"))).toBe(
      "terminal\necho hi",
    );
    expect(messageSearchText(toolResult("tr1", "output line"))).toBe("output line");
    expect(
      messageSearchText({
        id: "c1",
        kind: "clarify",
        role: "agent",
        requestId: "req",
        question: "Which env?",
        choices: [],
      } as ChatMessage),
    ).toBe("Which env?");
  });

  it("excludes text the transcript never renders", () => {
    // Gateway system markers are filtered out of the visible transcript.
    expect(
      messageSearchText(user("u2", "[System: cwd is C:/tmp]")),
    ).toBe("");
    expect(
      messageSearchText({
        id: "f1",
        kind: "file_changes",
        role: "agent",
        changes: [],
      } as ChatMessage),
    ).toBe("");
  });
});

describe("countOccurrences", () => {
  it("counts case-insensitively without double-counting overlaps", () => {
    expect(countOccurrences("Abc abc ABC", "abc")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("nothing here", "zzz")).toBe(0);
  });

  it("returns zero for an empty query or empty text", () => {
    expect(countOccurrences("text", "")).toBe(0);
    expect(countOccurrences("", "q")).toBe(0);
  });
});

describe("findChatMatches", () => {
  it("orders matches by transcript position and numbers them per message", () => {
    const messages = [
      user("u1", "needle one"),
      agent("a1", "needle two and needle three"),
      reasoning("r1", "no match here"),
      toolResult("t1", "NEEDLE four"),
    ];
    expect(findChatMatches(messages, "needle")).toEqual([
      { messageId: "u1", indexInMessage: 0 },
      { messageId: "a1", indexInMessage: 0 },
      { messageId: "a1", indexInMessage: 1 },
      { messageId: "t1", indexInMessage: 0 },
    ]);
  });

  it("matches nothing for an empty query and ignores unrendered rows", () => {
    expect(findChatMatches([user("u1", "anything")], "")).toEqual([]);
    expect(
      findChatMatches([user("u1", "[System: hidden needle]")], "needle"),
    ).toEqual([]);
  });

  it("counts matches inside collapsed history (the whole chat, not the DOM)", () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      user(`u${i}`, i === 3 ? "buried needle" : "filler"),
    );
    expect(findChatMatches(messages, "needle")).toEqual([
      { messageId: "u3", indexInMessage: 0 },
    ]);
  });
});

describe("stepMatchIndex", () => {
  it("wraps in both directions", () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
  });

  it("jumps to an end when there is no current match", () => {
    expect(stepMatchIndex(-1, 3, 1)).toBe(0);
    expect(stepMatchIndex(-1, 3, -1)).toBe(2);
    expect(stepMatchIndex(9, 3, 1)).toBe(0);
  });

  it("returns -1 with nothing to step through", () => {
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
  });
});
