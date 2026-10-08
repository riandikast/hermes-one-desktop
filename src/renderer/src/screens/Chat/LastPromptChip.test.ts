// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  findLastPrompt,
  isScrollable,
  lastPromptPreview,
  shouldShowLastPromptChip,
} from "./LastPromptChip";
import type { ChatBubbleMessage, ChatMessage } from "./types";

/**
 * The last-prompt chip lets an old conversation be identified without
 * scrolling. Two things must hold: it resolves the right prompt (skipping
 * overlay/empty rows), and it never renders a multi-line blob.
 */

const user = (id: string, content: string): ChatBubbleMessage => ({
  id,
  role: "user",
  content,
});
const agent = (id: string, content: string): ChatBubbleMessage => ({
  id,
  role: "agent",
  content,
});

describe("findLastPrompt", () => {
  it("returns the LAST user message", () => {
    const found = findLastPrompt([
      user("u1", "first question"),
      agent("a1", "an answer"),
      user("u2", "second question"),
      agent("a2", "another answer"),
    ]);
    expect(found?.id).toBe("u2");
    expect(found?.content).toBe("second question");
  });

  it("returns null when there is no user message", () => {
    expect(findLastPrompt([agent("a1", "hello")])).toBeNull();
    expect(findLastPrompt([])).toBeNull();
  });

  it("skips an empty trailing user message (attachment-only turn)", () => {
    // The newest user row has no text, so the chip falls back to the previous
    // real prompt rather than showing an empty bubble.
    const found = findLastPrompt([
      user("u1", "real question"),
      agent("a1", "answer"),
      user("u2", "   "),
    ]);
    expect(found?.id).toBe("u1");
  });

  it("skips a runtime injection and returns the user's prompt", () => {
    // The reported bug: a background-task report landed after the real prompt,
    // so the chip showed the report instead of what the user typed.
    const found = findLastPrompt([
      user("u1", "real question"),
      agent("a1", "answer"),
      user("i1", "[IMPORTANT: Background process proc_x completed normally"),
    ]);
    expect(found?.id).toBe("u1");
  });

  it("ignores overlay rows that are not real prompts", () => {
    const overlay = {
      id: "overlay-1",
      kind: "reasoning",
      content: "thinking aloud",
    } as unknown as ChatMessage;
    const found = findLastPrompt([user("u1", "the prompt"), overlay]);
    expect(found?.id).toBe("u1");
  });
});

describe("lastPromptPreview", () => {
  it("collapses whitespace to a single line", () => {
    expect(lastPromptPreview("  hello\n\n  world  ")).toBe("hello world");
  });

  it("truncates a long prompt with an ellipsis", () => {
    const long = "a".repeat(300);
    const out = lastPromptPreview(long, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("keeps a short prompt intact", () => {
    expect(lastPromptPreview("short one")).toBe("short one");
  });

  it("returns an empty string for blank content", () => {
    expect(lastPromptPreview("   \n  ")).toBe("");
    expect(lastPromptPreview("")).toBe("");
  });
});

describe("isScrollable", () => {
  it("is true only with real overflow, not a sub-pixel rounding gap", () => {
    expect(isScrollable(1200, 400)).toBe(true);
    // A 1px slack is measurement noise, not something to scroll.
    expect(isScrollable(401, 400)).toBe(false);
    expect(isScrollable(400, 400)).toBe(false);
    expect(isScrollable(300, 400)).toBe(false);
  });

  it("treats a tiny overflow as scrollable (the chip needs only a little)", () => {
    // 20px of overflow is genuinely scrollable; the old code required >60px via
    // the bottom-proximity tolerance and hid the chip for short-ish chats.
    expect(isScrollable(420, 400)).toBe(true);
  });
});

describe("shouldShowLastPromptChip", () => {
  it("requires BOTH scrollability and scrolled-up", () => {
    expect(shouldShowLastPromptChip(true, true)).toBe(true);
    // At the bottom the real prompt is already visible -> no duplicate chip.
    expect(shouldShowLastPromptChip(true, false)).toBe(false);
    // A short chat has nothing to navigate.
    expect(shouldShowLastPromptChip(false, true)).toBe(false);
    expect(shouldShowLastPromptChip(false, false)).toBe(false);
  });
});
