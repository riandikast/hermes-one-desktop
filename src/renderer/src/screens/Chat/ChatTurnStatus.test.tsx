// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatTurnStatus } from "./ChatTurnStatus";
import type { ChatMessage } from "./types";

function msg(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return partial as ChatMessage;
}

describe("ChatTurnStatus", () => {
  it("renders nothing when the turn is not loading", () => {
    const { container } = render(
      <ChatTurnStatus isLoading={false} messages={[]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows Thinking… while the last row is reasoning", () => {
    render(
      <ChatTurnStatus
        isLoading
        messages={[
          msg({ id: "u", role: "user", content: "hi" }),
          msg({ id: "r", role: "agent", kind: "reasoning", text: "hmm" }),
        ]}
      />,
    );
    expect(screen.getByText(/Thinking…/)).toBeTruthy();
  });

  it("shows the running tool name for an unresolved tool call", () => {
    render(
      <ChatTurnStatus
        isLoading
        messages={[
          msg({ id: "u", role: "user", content: "build" }),
          msg({
            id: "tc",
            role: "agent",
            kind: "tool_call",
            callId: "c1",
            name: "flutter",
            args: "{}",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Running flutter/)).toBeTruthy();
  });

  it("shows Working… when nothing specific is identifiable", () => {
    render(
      <ChatTurnStatus
        isLoading
        messages={[msg({ id: "u", role: "user", content: "hi" })]}
      />,
    );
    expect(screen.getByText(/Working…/)).toBeTruthy();
  });

  it("does not show a tool that already has its result", () => {
    render(
      <ChatTurnStatus
        isLoading
        messages={[
          msg({ id: "u", role: "user", content: "build" }),
          msg({
            id: "tc",
            role: "agent",
            kind: "tool_call",
            callId: "c1",
            name: "flutter",
            args: "{}",
          }),
          msg({
            id: "tr",
            role: "agent",
            kind: "tool_result",
            callId: "c1",
            name: "flutter",
            content: "ok",
          }),
        ]}
      />,
    );
    expect(screen.queryByText(/Running flutter/)).toBeNull();
  });
});
