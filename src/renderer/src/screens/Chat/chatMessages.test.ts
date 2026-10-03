// A failed send writes its error INTO the transcript as a renderer-only bubble
// (`markActiveTurnFailed`); there is no toast. Nothing used to remove one, so a
// transient refusal (e.g. the backend's "chat is open in another Hermes
// window/terminal" lease conflict, which clears on its own) stayed on screen
// forever and read as a live fault hours later.
import { describe, expect, it } from "vitest";
import {
  clearStaleTurnErrors,
  isSilencedErrorMessage,
  markActiveTurnFailed,
} from "./chatMessages";
import type { ChatMessage } from "./types";

const errBubble = (
  id: string,
  extra: Record<string, unknown> = {},
): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  error: "This chat is open in another Hermes window/terminal.",
  localOnly: true,
  ...extra,
});

describe("clearStaleTurnErrors", () => {
  it("drops a renderer-only turn-failure bubble", () => {
    const messages = [
      { id: "user-1", role: "user", content: "hi" } as ChatMessage,
      errBubble("error-123"),
    ];
    expect(clearStaleTurnErrors(messages)).toEqual([messages[0]]);
  });

  it("keeps canonical DB rows that carry an error", () => {
    // A stored row is real conversation history, not a transient UI failure.
    const stored = {
      id: "db-42",
      role: "agent",
      content: "boom",
      error: "provider error",
      localOnly: true,
    } as ChatMessage;
    expect(clearStaleTurnErrors([stored])).toEqual([stored]);
  });

  it("keeps a pending error (the turn is still being marked)", () => {
    const pending = errBubble("error-live", { pending: true });
    expect(clearStaleTurnErrors([pending])).toEqual([pending]);
  });

  it("keeps ordinary messages and non-error bubbles untouched", () => {
    const messages = [
      { id: "user-1", role: "user", content: "hi" } as ChatMessage,
      { id: "db-1", role: "agent", content: "hello" } as ChatMessage,
      { id: "db-r-1", kind: "reasoning", role: "agent", text: "…" } as ChatMessage,
    ];
    expect(clearStaleTurnErrors(messages)).toEqual(messages);
  });

  it("returns the same contents when there is nothing to clear", () => {
    const messages = [
      { id: "user-1", role: "user", content: "hi" } as ChatMessage,
    ];
    const out = clearStaleTurnErrors(messages);
    expect(out).toEqual(messages);
    expect(out).not.toBe(messages); // always a fresh array (never mutated)
    expect(messages).toHaveLength(1);
  });
});

describe("isSilencedErrorMessage", () => {
  it("silences the raw_system_prompt version-skew complaint", () => {
    expect(
      isSilencedErrorMessage(
        "invalid params for prompt.submit: raw_system_prompt: Extra inputs are not permitted",
      ),
    ).toBe(true);
  });

  it("silences the ownership refusal in both spellings", () => {
    expect(
      isSilencedErrorMessage(
        "This chat is open in another Hermes window/terminal.",
      ),
    ).toBe(true);
    expect(isSilencedErrorMessage("SESSION_NOT_OWNED")).toBe(true);
    expect(isSilencedErrorMessage("session already has a live owner")).toBe(
      true,
    );
  });

  it("does NOT silence real provider/transport failures", () => {
    for (const real of [
      "HTTP 503: The usage limit has been reached",
      "Connection error",
      "401 Unauthorized: invalid api key",
      "Model `oc/mimo-v2.6-flash-free` was not found in this provider's model listing.",
      "request timed out",
    ]) {
      expect(isSilencedErrorMessage(real)).toBe(false);
    }
  });

  it("treats empty/whitespace as not silenced (handled elsewhere)", () => {
    expect(isSilencedErrorMessage("")).toBe(false);
    expect(isSilencedErrorMessage("   ")).toBe(false);
  });
});

describe("markActiveTurnFailed with silenced errors", () => {
  const userRow = { id: "u1", role: "user", content: "hi" } as ChatMessage;

  it("writes no error bubble for suppressed noise", () => {
    const out = markActiveTurnFailed(
      [userRow],
      "invalid params for prompt.submit: raw_system_prompt: Extra inputs are not permitted",
      { turnId: "t1", userId: "u1" },
    );
    expect(out.some((m) => "error" in m && (m as { error?: string }).error)).toBe(
      false,
    );
    expect(out).toHaveLength(1);
  });

  it("still writes a bubble for a real failure", () => {
    const out = markActiveTurnFailed([userRow], "Connection error", {
      turnId: "t1",
      userId: "u1",
    });
    const withErr = out.filter(
      (m) => "error" in m && Boolean((m as { error?: string }).error),
    );
    expect(withErr).toHaveLength(1);
    expect((withErr[0] as { error?: string }).error).toBe("Connection error");
  });
});
