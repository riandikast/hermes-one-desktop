// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatSearch } from "./ChatSearch";
import type { ChatMessage } from "./types";
const message = (id: string, content: string): ChatMessage => ({ id, role: "agent", content });
const count = () => document.querySelector(".chat-search-count")?.textContent;
const query = (value: string) => fireEvent.change(screen.getByLabelText("Search text in chat"), { target: { value } });
describe("persisted chat search", () => {
  it("keeps the selected stable occurrence when earlier hits are prepended", async () => {
    const reveal = vi.fn();
    const props = { open: true, onOpenChange: () => {}, onRevealMessage: reveal };
    const view = render(<ChatSearch {...props} messages={[message("b", "needle needle")]} />);
    query("needle");
    // The count can commit before selection/reveal effects finish reconciling.
    await waitFor(() => {
      expect(count()).toBe("1/2");
      expect(screen.getByLabelText("Next match")).toBeEnabled();
      expect(reveal).toHaveBeenLastCalledWith("b");
    });
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(count()).toBe("2/2");
    view.rerender(<ChatSearch {...props} messages={[message("a", "needle"), message("b", "needle needle")]} />);
    await waitFor(() => expect(count()).toBe("3/3"));
    expect(reveal).toHaveBeenLastCalledWith("b");
  });
  it("indexes an unloaded distant row, preserves occurrence order and wraps", async () => {
    const reveal = vi.fn();
    const search = vi.fn().mockResolvedValue([message("db-1", "needle needle")]);
    render(<ChatSearch messages={[message("db-9000", "needle")]} open onOpenChange={() => {}} searchHistory={search} onRevealMessage={reveal} />);
    query("needle");
    await waitFor(() => expect(count()).toBe("1/3"));
    expect(reveal).toHaveBeenLastCalledWith("db-1");
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(count()).toBe("2/3");
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(reveal).toHaveBeenLastCalledWith("db-9000");
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(count()).toBe("1/3");
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(count()).toBe("3/3");
  });
  it("ignores superseded asynchronous results and disables stale navigation", async () => {
    let finish!: (messages: ChatMessage[]) => void;
    const search = vi.fn((value: string) => value === "old" ? new Promise<ChatMessage[]>(r => { finish = r; }) : Promise.resolve([message("db-2", "new")]));
    const reveal = vi.fn();
    render(<ChatSearch messages={[]} open onOpenChange={() => {}} searchHistory={search} onRevealMessage={reveal} />);
    query("old");
    await waitFor(() => expect(search).toHaveBeenCalledWith("old"));
    query("new");
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    await waitFor(() => expect(reveal).toHaveBeenLastCalledWith("db-2"));
    await act(async () => finish([message("db-1", "old old")]));
    expect(count()).toBe("1/1");
    expect(reveal).not.toHaveBeenCalledWith("db-1");
  });
});
