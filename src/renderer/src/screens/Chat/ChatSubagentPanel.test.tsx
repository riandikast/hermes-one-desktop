// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatSubagentPanel } from "./ChatSubagentPanel";
import type { ActiveSubagent } from "./hooks/useActiveSubagents";

const child = (partial: Partial<ActiveSubagent> & { subagent_id: string }): ActiveSubagent =>
  partial;

describe("ChatSubagentPanel", () => {
  it("renders nothing when no subagents are running", () => {
    const { container } = render(
      <ChatSubagentPanel subagents={[]} onOpenSubagent={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each running child with its activity and opens its session", () => {
    const onOpen = vi.fn();
    render(
      <ChatSubagentPanel
        subagents={[
          child({
            subagent_id: "a",
            goal: "map the parser",
            child_session_id: "child-a",
            last_tool: "read_file",
          }),
          child({ subagent_id: "b", child_session_id: "child-b" }),
        ]}
        onOpenSubagent={onOpen}
        defaultOpen
      />,
    );

    expect(screen.getByText("2 subagents running")).toBeTruthy();
    // Activity reflects what the child is doing, not a bare spinner.
    expect(screen.getByText("Running read_file")).toBeTruthy();
    expect(screen.getByText("map the parser")).toBeTruthy();

    const viewButtons = screen.getAllByRole("button", { name: /view/i });
    expect(viewButtons).toHaveLength(2);
    fireEvent.click(viewButtons[1]!);
    expect(onOpen).toHaveBeenCalledWith("child-b");
  });

  it("does not offer a View button when the snapshot has no child session", () => {
    const onOpen = vi.fn();
    render(
      <ChatSubagentPanel
        subagents={[child({ subagent_id: "a" })]}
        onOpenSubagent={onOpen}
        defaultOpen
      />,
    );
    // A dead button would be worse than no button: say the session is not
    // available yet instead of opening nothing.
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
  });

  it("surfaces a child already running as soon as it appears", () => {
    const { rerender } = render(
      <ChatSubagentPanel subagents={[]} onOpenSubagent={vi.fn()} />,
    );
    rerender(
      <ChatSubagentPanel
        subagents={[child({ subagent_id: "a", child_session_id: "child-a" })]}
        onOpenSubagent={vi.fn()}
      />,
    );
    // Auto-expanded, so View is reachable without a click.
    expect(screen.getByRole("button", { name: /view/i })).toBeTruthy();
    expect(screen.getByText("1 subagent running")).toBeTruthy();
  });

  it("stays collapsed after the user collapses it, even as children change", () => {
    const { rerender } = render(
      <ChatSubagentPanel
        subagents={[child({ subagent_id: "a", child_session_id: "child-a" })]}
        onOpenSubagent={vi.fn()}
        defaultOpen
      />,
    );
    fireEvent.click(screen.getByText("1 subagent running"));
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();

    // A new child arriving must not spring the list back open.
    rerender(
      <ChatSubagentPanel
        subagents={[
          child({ subagent_id: "a", child_session_id: "child-a" }),
          child({ subagent_id: "b", child_session_id: "child-b" }),
        ]}
        onOpenSubagent={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
    expect(screen.getByText("2 subagents running")).toBeTruthy();
  });
});
