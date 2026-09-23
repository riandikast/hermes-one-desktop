import { describe, expect, it } from "vitest";
import { buildSessionHandoff } from "./sessionHandoff";
import type { ChatMessage } from "./types";

function user(content: string, id = `u-${Math.random()}`): ChatMessage {
  return { id, role: "user", content };
}
function agent(content: string, id = `a-${Math.random()}`): ChatMessage {
  return { id, role: "agent", content };
}

describe("buildSessionHandoff", () => {
  it("returns one user bubble", () => {
    const { message } = buildSessionHandoff([user("hello"), agent("hi")]);
    expect(message.role).toBe("user");
    expect(message.id).toMatch(/^handoff-/);
  });

  it("marks the block as a handoff and forbids re-derivation", () => {
    const { message } = buildSessionHandoff([user("fix the bug"), agent("done")]);
    expect(message.content).toContain("## Session handoff");
    expect(message.content).toContain("do not re-derive");
  });

  it("carries the tail verbatim within the window", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 12; i++) {
      msgs.push(user(`question ${i}`, `u${i}`));
      msgs.push(agent(`answer ${i}`, `a${i}`));
    }
    const { message, info } = buildSessionHandoff(msgs);
    expect(message.content).toContain("question 11");
    expect(message.content).toContain("answer 11");
    expect(info.tailCount).toBe(10);
    expect(info.outlinedCount).toBe(2);
  });

  it("outlines earlier prompts as one-liners", () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 12; i++) {
      msgs.push(user(`please handle task number ${i} with lots of detail`, `u${i}`));
      msgs.push(agent(`ok ${i}`, `a${i}`));
    }
    const { message } = buildSessionHandoff(msgs);
    expect(message.content).toContain("### Earlier in that conversation");
    expect(message.content).toContain("please handle task number 0");
    // Outlined lines are collapsed (no verbatim assistant text from the head)
    expect(message.content).not.toContain("ok 0\n");
  });

  it("short sessions produce no outline section", () => {
    const { message, info } = buildSessionHandoff([
      user("a"),
      agent("b"),
      user("c"),
      agent("d"),
    ]);
    expect(message.content).not.toContain("### Earlier in that conversation");
    expect(info.outlinedCount).toBe(0);
  });

  it("carries the last error of a turn", () => {
    const { message } = buildSessionHandoff([
      user("run the build"),
      { id: "e", role: "agent", content: "", error: "Invalid API Key" },
    ]);
    expect(message.content).toContain("**Last error:** Invalid API Key");
  });

  it("derives the title from the first user prompt", () => {
    const { info } = buildSessionHandoff([
      user("fix the login redirect loop"),
      agent("on it"),
    ]);
    expect(info.title).toBe("fix the login redirect loop");
  });

  it("skips streaming placeholders and local-only rows", () => {
    const { message } = buildSessionHandoff([
      user("q"),
      { id: "p", role: "agent", content: "", pending: true },
      agent("real answer"),
      { id: "l", role: "user", content: "slash noise", localOnly: true },
    ]);
    expect(message.content).toContain("real answer");
    expect(message.content).not.toContain("slash noise");
  });

  it("bounds very long assistant answers in the tail", () => {
    const long = "x".repeat(5000);
    const { message } = buildSessionHandoff([user("q"), agent(long)]);
    // The verbatim answer is truncated to ~600 chars + ellipsis
    expect(message.content.length).toBeLessThan(1200);
    expect(message.content).toContain("…");
  });

  it("handles an empty transcript without crashing", () => {
    const { message, info } = buildSessionHandoff([]);
    expect(message.role).toBe("user");
    expect(info.title).toBe("Continued session");
  });
});
