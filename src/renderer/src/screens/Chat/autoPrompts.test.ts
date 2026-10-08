// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isAutoInjectedPrompt } from "./autoPrompts";
import { findLastPrompt, findRecentPrompts } from "./LastPromptChip";
import type { ChatBubbleMessage, ChatMessage } from "./types";

/**
 * The last-prompt chip reads the newest `role="user"` row, but the RUNTIME also
 * writes its own rows into that same stream — background-process completion
 * notices, delegation batch reports, compaction handoffs, model-change notices.
 * Before this detector, the chip showed those instead of the user's prompt
 * ("sometimes last prompt got mixed by auto background task report prompt").
 *
 * These are the ACTUAL prefixes observed in the user's state.db, so a
 * regression that drops one shows up here rather than silently in the UI.
 */

const user = (id: string, content: string): ChatBubbleMessage => ({
  id,
  role: "user",
  content,
});

describe("isAutoInjectedPrompt", () => {
  it("matches the real injected markers seen in the state DB", () => {
    const injected = [
      "[System: The active model for this chat has changed to cbai/x via provider 9r.",
      "[System note: Your previous turn was interrupted mid-run",
      "[IMPORTANT: Background process proc_1fe321f9fe1a completed normally (exit code 0).",
      "[ASYNC DELEGATION BATCH COMPLETE — deleg_40ac47b4] A background fan-out unit",
      "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted",
      "[Your active task list was preserved across context compression]",
      "[OUT-OF-BAND USER MESSAGE — a direct message from the user",
      "[STILL IN PROGRESS — this is the active request",
      "[plugin:@tailwindcss/vite:generate:serve] Invalid declaration",
      "[Package Manager Window] Error fetching package list.",
    ];
    for (const content of injected) {
      expect(isAutoInjectedPrompt(content), content).toBe(true);
    }
  });

  it("tolerates the leading whitespace some rows are stored with", () => {
    expect(isAutoInjectedPrompt("\n\n[System: model changed")).toBe(true);
    expect(isAutoInjectedPrompt("   [IMPORTANT: done")).toBe(true);
  });

  it("matches the bridge-relay paste shape", () => {
    expect(
      isAutoInjectedPrompt(
        "[8/27/2026 1:23 PM] Andika: /resume 20260827_115357_c1094a all\n[8/27/2026 1:24 PM] HermesBot in reply",
      ),
    ).toBe(true);
  });

  it("does NOT match a real prompt, even one starting with a bracket", () => {
    // The whole reason this is a prefix ALLOWLIST and not "starts with [":
    // a user may legitimately bracket their own message, and hiding a real
    // prompt is worse than showing an injection.
    const real = [
      "[bug] the dialog won't close",
      "[TODO] refactor the transport",
      "why is the chip showing the wrong prompt?",
      "yeah just commit",
      "System: I want you to explain this",
    ];
    for (const content of real) {
      expect(isAutoInjectedPrompt(content), content).toBe(false);
    }
  });

  it("ignores empty content", () => {
    expect(isAutoInjectedPrompt("")).toBe(false);
    expect(isAutoInjectedPrompt("   \n  ")).toBe(false);
  });
});

describe("findLastPrompt with injections", () => {
  it("skips a trailing injection and returns the user's real prompt", () => {
    const found = findLastPrompt([
      user("u1", "the real prompt"),
      { id: "a1", role: "agent", content: "answer" } as ChatMessage,
      user("i1", "[IMPORTANT: Background process proc_x completed normally"),
      user(
        "i2",
        "[ASYNC DELEGATION BATCH COMPLETE — deleg_1] subagent results",
      ),
    ]);
    expect(found?.id).toBe("u1");
    expect(found?.content).toBe("the real prompt");
  });

  it("still returns null when EVERY user row is an injection", () => {
    expect(
      findLastPrompt([user("i1", "[System: model changed to x")]),
    ).toBeNull();
  });
});

describe("findRecentPrompts", () => {
  it("lists the newest prompts, newest first, skipping injections", () => {
    const found = findRecentPrompts(
      [
        user("u1", "first"),
        user("u2", "second"),
        user("i1", "[IMPORTANT: Background process done"),
        user("u3", "third"),
        user("i2", "[System: model changed"),
      ],
      5,
    );
    expect(found.map((m) => m.content)).toEqual(["third", "second", "first"]);
  });

  it("honours the limit", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => user(`u${i}`, `p${i}`));
    const found = findRecentPrompts(msgs, 5);
    expect(found).toHaveLength(5);
    expect(found[0].content).toBe("p9");
    expect(found[4].content).toBe("p5");
  });

  it("returns nothing for a non-positive limit", () => {
    expect(findRecentPrompts([user("u1", "p")], 0)).toEqual([]);
  });
});
