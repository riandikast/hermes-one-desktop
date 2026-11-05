import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./types";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string, options?: { count?: number }) => options?.count ? `${options.count} files changed` : key }) }));
vi.mock("./MessageRow", () => ({ HermesAvatar: () => null, MessageRow: ({ msg }: { msg: ChatMessage }) => <div data-testid={msg.id}>{msg.id}</div> }));
vi.mock("./HistoryRow", () => ({ ReasoningRow: () => null, ToolActivityGroup: () => null }));
vi.mock("../../components/AgentMarkdown", () => ({ AgentMarkdown: () => null }));

it("recovers reopened prompt chips from multi-file tool results without an assistant overlay", () => {
  const changes = ["C:/repo/a.ts", "C:/repo/b.ts"];
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", content: "edit two files" },
    { id: "tc", kind: "tool_call", role: "agent", callId: "edit", name: "functions.patch", args: "Patch two files" },
    { id: "tr", kind: "tool_result", role: "agent", callId: "edit", name: "functions.patch", content: JSON.stringify({ success: true, files_modified: changes }) },
    { id: "answer", role: "agent", content: "done" },
    { id: "u2", role: "user", content: "next prompt" },
  ];
  const onOpen = vi.fn();
  render(<MessageList messages={messages} isLoading toolProgress={null} onApprove={vi.fn()} onDeny={vi.fn()} onClarifyResolved={vi.fn()} onOpenFileChanges={onOpen} />);
  const chip = screen.getByRole("button", { name: /2 files changed/ });
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalledWith(changes.map((path) => expect.objectContaining({ path })));
});

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
