import { describe, expect, it } from "vitest";
import {
  applyDashboardStreamEvent,
  type DashboardEventState,
} from "../src/renderer/src/screens/Chat/dashboardEventAdapter";
import {
  markReasoningGrowth,
  reasoningStalledMs,
} from "../src/renderer/src/screens/Chat/reasoningStall";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

function reduceEvents(
  events: Parameters<typeof applyDashboardStreamEvent>[1][],
): ChatMessage[] {
  let state: DashboardEventState = {
    messages: [{ id: "u-1", role: "user", content: "make image" }],
    reasoningSegmentClosed: false,
  };
  events.forEach((event, index) => {
    state = applyDashboardStreamEvent(state, event, { now: 100 + index });
  });
  return state.messages;
}

describe("applyDashboardStreamEvent", () => {
  it("preserves reasoning, tool, and assistant output sequence", () => {
    const messages = reduceEvents([
      { type: "reasoning.delta", payload: { text: "I will check setup. " } },
      {
        type: "tool.start",
        payload: {
          tool_id: "call-health",
          name: "terminal",
          args: "curl /system_stats",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_id: "call-health",
          name: "terminal",
          result: "ok",
        },
      },
      { type: "message.delta", payload: { text: "Setup is ready. " } },
      { type: "reasoning.delta", payload: { text: "Now generate it." } },
      {
        type: "tool.start",
        payload: {
          tool_id: "call-generate",
          name: "execute_code",
          args: { script: "generate_duck.py" },
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_id: "call-generate",
          name: "execute_code",
          result: "saved duck.png",
        },
      },
      { type: "message.delta", payload: { text: "Done." } },
      { type: "message.complete", payload: {} },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "agent",
      "reasoning",
      "tool_call",
      "tool_result",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({ text: "I will check setup. " });
    expect(messages[4]).toMatchObject({ content: "Setup is ready. " });
    expect(messages[5]).toMatchObject({ text: "Now generate it." });
    expect(messages[8]).toMatchObject({ content: "Done.", pending: false });
  });

  it("updates a repeated stable tool call instead of duplicating it", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          command: "python script.py",
        },
      },
      {
        type: "tool.progress",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          preview: "running python script.py",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({
      kind: "tool_call",
      callId: "call-terminal",
      args: "running python script.py",
      status: "completed",
    });
    expect(messages[2]).toMatchObject({
      kind: "tool_result",
      callId: "call-terminal",
      content: "ok",
    });
  });

  it("does not append duplicate tool results for repeated completion events", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          command: "python script.py",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-terminal",
          name: "terminal",
          result: "ok",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "tool_call",
      "tool_result",
    ]);
  });

  it("renders clarify requests as assistant questions instead of tool rows", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          tool_call_id: "call-clarify",
          name: "clarify",
          question: "Which provider should I use?",
        },
      },
      {
        type: "clarify.request",
        payload: {
          request_id: "ask-1",
          question: "Which provider should I use?",
          choices: ["Use local", "Use cloud"],
        },
      },
      {
        type: "tool.complete",
        payload: {
          tool_call_id: "call-clarify",
          name: "clarify",
          result: "Use local",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      id: "clarify-ask-1",
      content: "Which provider should I use?\n\n1. Use local\n2. Use cloud",
      localOnly: true,
    });
  });

  it("drops empty unstable tool-start placeholders before the detailed call event", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: {
          name: "skill_view",
        },
      },
      {
        type: "tool.start",
        payload: {
          name: "skill_view",
          arguments: { name: "ai-playground-image-gen" },
        },
      },
      {
        type: "tool.complete",
        payload: {
          name: "skill_view",
          arguments: { name: "ai-playground-image-gen" },
          result: "loaded",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "tool_call",
      "tool_result",
    ]);
    expect(messages[1]).toMatchObject({
      kind: "tool_call",
      name: "skill_view",
      args: '{"name":"ai-playground-image-gen"}',
    });
  });

  it("keeps parallel tool completions at their event position while sharing call ids", () => {
    const messages = reduceEvents([
      {
        type: "tool.start",
        payload: { tool_id: "call-a", name: "terminal", command: "first" },
      },
      {
        type: "tool.start",
        payload: { tool_id: "call-b", name: "terminal", command: "second" },
      },
      {
        type: "tool.complete",
        payload: { tool_id: "call-a", name: "terminal", result: "first done" },
      },
      {
        type: "tool.complete",
        payload: { tool_id: "call-b", name: "terminal", result: "second done" },
      },
    ]);

    expect(messages.map((m) => m.id)).toEqual([
      "u-1",
      "tool-call-call-a",
      "tool-call-call-b",
      "tool-result-call-a-3",
      "tool-result-call-b-4",
    ]);
    expect(messages[1]).toMatchObject({
      callId: "call-a",
      status: "completed",
    });
    expect(messages[2]).toMatchObject({
      callId: "call-b",
      status: "completed",
    });
    expect(messages[3]).toMatchObject({ callId: "call-a" });
    expect(messages[4]).toMatchObject({ callId: "call-b" });
  });

  it("marks final streamed assistant bubbles complete without appending duplicate final text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "time" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "It is " } },
      { now: 200 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "6:51 PM." } },
      { now: 201 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.complete", payload: {} },
      { now: 202 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("It is 6:51 PM.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("uses full final text as a replacement for matching streamed deltas", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "time" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "It is 6" } },
      { now: 300 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.complete", payload: { text: "It is 6:51 PM." } },
      { now: 301 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("It is 6:51 PM.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("materializes the answer from final_response when the payload has no text key", () => {
    // Some gateway transports deliver the completion text under
    // `final_response` instead of `text` — without this fallback the answer
    // bubble was never created while isLoading still flipped false (the
    // intermittent "last answer missing even though the chime fired" bug).
    let state: DashboardEventState = {
      messages: [
        { id: "u-1", role: "user", content: "time" },
        { id: "r-1", kind: "reasoning", role: "agent", text: "Let me check." },
      ],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { status: "completed", final_response: "It is 6:51 PM." },
      },
      { now: 301 },
    );

    const kinds = state.messages.map((m) => ("kind" in m ? m.kind : m.role));
    expect(kinds).toEqual(["user", "reasoning", "agent"]);
    const agent = state.messages[2] as ChatMessage & { content: string };
    expect(agent.content).toBe("It is 6:51 PM.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("moves the completed final answer to the END after trailing tool/reasoning rows", () => {
    // The gateway streamed: answer text → tools → trailing thought. The final
    // text must not stay merged mid-transcript (answer "cut" above the tools);
    // the completed bubble moves after the trailing rows so the turn reads
    // "…tools → thought → final answer".
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "deploy" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "Done. " } },
      { now: 400 },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "tool.start",
        payload: { tool_id: "t1", name: "terminal", args: "swap" },
      },
      { now: 401 },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "tool.complete",
        payload: { tool_id: "t1", name: "terminal", result: "ok" },
      },
      { now: 402 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "reasoning.delta", payload: { text: "Verify the swap." } },
      { now: 403 },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { text: "Done. The stock swap is complete." },
      },
      { now: 404 },
    );

    const kinds = state.messages.map((m) => ("kind" in m ? m.kind : m.role));
    // Answer moved to the END, after the tool rows and the trailing thought.
    expect(kinds).toEqual([
      "user",
      "tool_call",
      "tool_result",
      "reasoning",
      "agent",
    ]);
    const last = state.messages[4] as ChatMessage & { content: string };
    expect(last.content).toBe("Done. The stock swap is complete.");
  });

  it("replaces mismatched streamed deltas with the final completion text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "korean" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "맞,측으로 말했습니다. " } },
      { now: 310 },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { text: "맞아요. 추측으로 말했습니다." },
      },
      { now: 311 },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("맞아요. 추측으로 말했습니다.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("can suppress assistant deltas and render only final completion text", () => {
    let state: DashboardEventState = {
      messages: [{ id: "u-1", role: "user", content: "korean" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "맞,측으로 말했습니다. " } },
      { now: 320, renderAssistantDeltas: false },
    );
    state = applyDashboardStreamEvent(
      state,
      {
        type: "message.complete",
        payload: { text: "맞아요. 추측으로 말했습니다." },
      },
      { now: 321, renderAssistantDeltas: false },
    );

    const agent = state.messages[1] as ChatMessage & { content: string };
    expect(state.messages).toHaveLength(2);
    expect(agent.content).toBe("맞아요. 추측으로 말했습니다.");
    expect(agent).toMatchObject({ pending: false });
  });

  it("does not show late reasoning snapshots that duplicate streamed assistant text", () => {
    const messages = reduceEvents([
      { type: "message.delta", payload: { text: "Done with the image." } },
      {
        type: "reasoning.available",
        payload: { text: "Done with the image." },
      },
      {
        type: "message.complete",
        payload: { text: "Done with the image." },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "Done with the image.",
      pending: false,
    });
  });

  it("removes reasoning rows that duplicate final completion text", () => {
    const messages = reduceEvents([
      {
        type: "reasoning.available",
        payload: { text: "The answer is 42." },
      },
      {
        type: "message.complete",
        payload: { text: "The answer is 42." },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "The answer is 42.",
      pending: false,
    });
  });

  it("uses non-duplicate completion reasoning when no reasoning streamed", () => {
    const messages = reduceEvents([
      {
        type: "message.complete",
        payload: {
          reasoning: "I checked the clock before answering.",
          text: "It is 6:51 PM.",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      text: "I checked the clock before answering.",
    });
    expect(messages[2]).toMatchObject({
      content: "It is 6:51 PM.",
      pending: false,
    });
  });

  it("does not use completion reasoning when it duplicates the final answer", () => {
    const messages = reduceEvents([
      {
        type: "message.complete",
        payload: {
          reasoning: "It is 6:51 PM.",
          text: "It is 6:51 PM.",
        },
      },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "agent",
    ]);
    expect(messages[1]).toMatchObject({
      content: "It is 6:51 PM.",
      pending: false,
    });
  });

  it("ignores spinner thinking deltas and strips thinking placeholders", () => {
    const messages = reduceEvents([
      { type: "thinking.delta", payload: { text: "Hermes thinking..." } },
      {
        type: "reasoning.delta",
        payload: { text: "Thinking...current rewritten thinking" },
      },
      { type: "reasoning.delta", payload: { text: "Actual reasoning." } },
    ]);

    expect(messages.map((m) => ("kind" in m ? m.kind : m.role))).toEqual([
      "user",
      "reasoning",
    ]);
    expect(messages[1]).toMatchObject({ text: "Actual reasoning." });
  });

  it("marks the trailing thought settled at message.complete so the answer gate does not wait the full settle", () => {
    // A turn that ends on a trailing thought (last growth just now) without a
    // tool boundary after it: the gate would otherwise wait REASONING_SETTLE_MS
    // (1200ms) for the thought to "settle". message.complete must mark it
    // settled so the gate opens on the next poll without the stall wait.
    // Unique `now` baseline keeps the reasoning id isolated from other tests'
    // module-scope state.
    let state: DashboardEventState = {
      messages: [{ id: "u-settle", role: "user", content: "go" }],
      reasoningSegmentClosed: false,
    };
    state = applyDashboardStreamEvent(
      state,
      { type: "reasoning.delta", payload: { text: "Let me think. " } },
      { now: 7000 },
    );
    const reasoning = state.messages.find(
      (m) => "kind" in m && m.kind === "reasoning",
    ) as { id: string } | undefined;
    expect(reasoning).toBeDefined();
    if (!reasoning) return;
    // Simulate the ReasoningRow stamping its last delta (just now) and confirm
    // the row is NOT yet settled (stalledMs is small, not MAX).
    markReasoningGrowth(reasoning.id);
    expect(reasoningStalledMs(reasoning.id)).toBeLessThan(
      Number.MAX_SAFE_INTEGER,
    );

    // A trailing answer + a late thought, then the turn completes.
    state = applyDashboardStreamEvent(
      state,
      { type: "message.delta", payload: { text: "partial answer. " } },
      { now: 7001 },
    );
    state = applyDashboardStreamEvent(
      state,
      { type: "message.complete", payload: { text: "partial answer. " } },
      { now: 7002 },
    );
    // message.complete marked the trailing thought settled → the gate treats it
    // as immediately ready, skipping the 1.2s stall.
    expect(reasoningStalledMs(reasoning.id)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
