import { describe, expect, it } from "vitest";
import {
  attachSessionFileChanges,
  continuationItemsToHistory,
  mergeSessionLocalErrors,
  normalizeContinuationItems,
} from "../src/main/session-continuation-store";

describe("desktop session continuations", () => {
  it("normalizes and expands a visible prefix including errors and tool rows", () => {
    const normalized = normalizeContinuationItems([
      { kind: "user", content: "bad turn" },
      { kind: "assistant", content: "", error: "Invalid API Key" },
      { kind: "reasoning", text: "Need a tool." },
      {
        kind: "tool_call",
        callId: "call-1",
        name: "terminal",
        args: '{"command":"date"}',
      },
      {
        kind: "tool_result",
        callId: "call-1",
        name: "terminal",
        content: "Mon Jun 8",
      },
    ]);

    expect(normalized).toHaveLength(5);

    const history = continuationItemsToHistory(normalized);
    expect(history.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "reasoning",
      "tool_call",
      "tool_result",
    ]);
    expect(history[0].id).toBeLessThan(0);
    expect(history[1]).toMatchObject({
      kind: "assistant",
      content: "",
      error: "Invalid API Key",
    });
    expect(history[3]).toMatchObject({
      kind: "tool_call",
      callId: "call-1",
      name: "terminal",
    });
  });

  it("drops empty placeholder rows but preserves empty assistant error bubbles", () => {
    expect(
      normalizeContinuationItems([
        { kind: "user", content: "   " },
        { kind: "assistant", content: "", error: "boom" },
        { kind: "reasoning", text: "" },
      ]),
    ).toEqual([{ kind: "assistant", content: "", error: "boom" }]);
  });

  it("clears assistant content when it duplicates the preserved error text", () => {
    expect(
      normalizeContinuationItems([
        {
          kind: "assistant",
          content: "Invalid API Key",
          error: "Invalid API Key",
        },
      ]),
    ).toEqual([{ kind: "assistant", content: "", error: "Invalid API Key" }]);
  });

  it("inserts local provider errors after the matching canonical user row", () => {
    const merged = mergeSessionLocalErrors(
      [
        { kind: "user", id: 1, content: "good", timestamp: 1 },
        { kind: "assistant", id: 2, content: "ok", timestamp: 2 },
        { kind: "user", id: 3, content: "bad provider", timestamp: 3 },
      ],
      [{ userContent: "bad provider", error: "Invalid API Key" }],
    );

    expect(merged.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(merged[3]).toMatchObject({
      kind: "assistant",
      content: "",
      error: "Invalid API Key",
    });
  });

  it("does not duplicate local provider errors already present in continuation rows", () => {
    const continuation = continuationItemsToHistory([
      { kind: "user", content: "bad provider" },
      { kind: "assistant", content: "", error: "Invalid API Key" },
      { kind: "user", content: "recovery" },
      { kind: "assistant", content: "OK" },
    ]);

    const merged = mergeSessionLocalErrors(continuation, [
      { userContent: "bad provider", error: "Invalid API Key" },
    ]);

    expect(
      merged.filter((item) => item.kind === "assistant" && item.error),
    ).toHaveLength(1);
    expect(merged.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("attaches persisted file changes to the LAST assistant bubble", () => {
    const items = [
      { kind: "user" as const, id: 1, content: "deploy", timestamp: 1 },
      {
        kind: "assistant" as const,
        id: 2,
        content: "old answer",
        timestamp: 2,
      },
      { kind: "user" as const, id: 3, content: "again", timestamp: 3 },
      { kind: "assistant" as const, id: 4, content: "final", timestamp: 4 },
      {
        kind: "reasoning" as const,
        id: 5,
        assistantId: 4,
        text: "…",
        timestamp: 5,
      },
    ];
    const changes = [{ path: "C:\\repo\\a.txt", before: "x", after: "y" }];

    const attached = attachSessionFileChanges(items, changes);

    // Badge lands on the LAST assistant bubble (id 4), not the earlier one.
    expect(attached[3]).toMatchObject({
      kind: "assistant",
      content: "final",
      fileChanges: changes,
    });
    expect(attached[1]).not.toHaveProperty("fileChanges");
  });

  it("leaves items unchanged when there are no persisted file changes", () => {
    const items = [
      { kind: "assistant" as const, id: 1, content: "ok", timestamp: 1 },
    ];
    expect(attachSessionFileChanges(items, [])).toEqual(items);
  });
});
