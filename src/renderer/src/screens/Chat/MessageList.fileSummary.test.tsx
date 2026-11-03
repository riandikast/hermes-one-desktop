import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./types";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string, options?: { count?: number }) => options?.count ? `${options.count} files changed` : key }) }));
vi.mock("./MessageRow", () => ({ HermesAvatar: () => null, MessageRow: ({ msg }: { msg: ChatMessage }) => <div data-testid={msg.id}>{msg.id}</div> }));
vi.mock("./HistoryRow", () => ({ ReasoningRow: () => null, ToolActivityGroup: () => null }));
vi.mock("../../components/AgentMarkdown", () => ({ AgentMarkdown: () => null }));

it("renders one cumulative footer below the latest response, hides it during continuation, preserves earlier prompt footers", () => {
  const a = { path: "a", before: "before", after: "middle" };
  const b = { path: "b", before: null, after: "created" };
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", content: "edit files" },
    { id: "interim", role: "agent", content: "interim" },
    { id: "fc1", role: "agent", kind: "file_changes", changes: [a] },
    { id: "notice", role: "user", content: "[System: continue]" },
    { id: "final", role: "agent", content: "final" },
    { id: "fc2", role: "agent", kind: "file_changes", changes: [{ ...a, before: "middle", after: "after" }, b] },
  ];
  const onOpen = vi.fn();
  const props = { messages, isLoading: false, toolProgress: null, onApprove: vi.fn(), onDeny: vi.fn(), onClarifyResolved: vi.fn(), onOpenFileChanges: onOpen };
  const view = render(<MessageList {...props} />);
  const chip = screen.getByRole("button", { name: /2 files changed/ });
  expect(screen.getByTestId("final").compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(view.container.querySelectorAll(".chat-file-changes-row")).toHaveLength(1);
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalledWith([{ ...a, after: "after" }, b]);
  view.rerender(<MessageList {...props} isLoading />);
  expect(view.container.querySelector(".chat-file-changes-row")).toBeNull();
  view.rerender(<MessageList {...props} messages={[...messages, { id: "u2", role: "user", content: "next request" }]} isLoading />);
  expect(view.container.querySelectorAll(".chat-file-changes-row")).toHaveLength(1);
  expect(messages.filter((row) => row.kind === "file_changes")).toHaveLength(2);
});
