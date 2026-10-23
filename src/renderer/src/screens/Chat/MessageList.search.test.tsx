// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./types";
vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (s: string) => s }) }));
vi.mock("./MessageRow", () => ({ HermesAvatar: () => null, MessageRow: ({ msg }: { msg: ChatMessage }) => <div id={`chat-msg-${msg.id}`}>{msg.id}</div> }));
vi.mock("./HistoryRow", () => ({ ReasoningRow: () => null, ToolActivityGroup: () => null }));
vi.mock("../../components/AgentMarkdown", () => ({ AgentMarkdown: () => null }));
describe("search render window", () => {
  it("reveals an old turn without mounting the intervening 9999 turns; closing restores tail", () => {
    const messages: ChatMessage[] = Array.from({ length: 10000 }, (_, i) => ({ id: `u${i}`, role: "user", content: `turn ${i}` }));
    const props = { messages, isLoading: false, toolProgress: null, onApprove: vi.fn(), onDeny: vi.fn(), onClarifyResolved: vi.fn() };
    const view = render(<MessageList {...props} revealMessageId="u1" />);
    expect(view.container.querySelector('[data-turn-id="u1"]')).not.toBeNull();
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(3);
    expect(view.container.querySelector('[data-turn-id="u9000"]')).toBeNull();
    view.rerender(<MessageList {...props} revealMessageId={null} />);
    expect(view.container.querySelector('[data-turn-id="u9999"]')).not.toBeNull();
    expect(view.container.querySelector('[data-turn-id="u1"]')).toBeNull();
  });
});
