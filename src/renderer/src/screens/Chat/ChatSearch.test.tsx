// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSearch } from "./ChatSearch";
import type { ChatMessage } from "./types";

const agent = (id: string, content: string): ChatMessage =>
  ({ id, role: "agent", content }) as ChatMessage;

function Harness({
  messages,
  onRevealMessage,
  onBeforeScroll,
}: {
  messages: ChatMessage[];
  onRevealMessage?: (id: string) => void;
  onBeforeScroll?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <ChatSearch
      messages={messages}
      open={open}
      onOpenChange={setOpen}
      onRevealMessage={onRevealMessage}
      onBeforeScroll={onBeforeScroll}
    />
  );
}

/** The debounce means the counter lags the typed value. */
async function typeQuery(value: string): Promise<HTMLInputElement> {
  const input = screen.getByLabelText("Search text in chat") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

const countText = (): string =>
  document.querySelector(".chat-search-count")?.textContent ?? "";

describe("ChatSearch", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("counts matches across the whole session and wraps with Enter / Shift+Enter", async () => {
    render(
      <Harness
        messages={[
          agent("a1", "needle one"),
          agent("a2", "filler"),
          agent("a3", "needle two and needle three"),
        ]}
      />,
    );

    await typeQuery("needle");
    await waitFor(() => expect(countText()).toBe("1/3"));

    const input = screen.getByLabelText("Search text in chat");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(countText()).toBe("2/3"));
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(countText()).toBe("3/3"));
    // Forward from the last match wraps to the first.
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(countText()).toBe("1/3"));
    // Backwards from the first wraps to the last.
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(countText()).toBe("3/3"));
  });

  it("shows 0/0 and disables navigation when nothing matches", async () => {
    render(<Harness messages={[agent("a1", "hello")]} />);
    await typeQuery("zzz");
    await waitFor(() => expect(countText()).toBe("0/0"));
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    expect(screen.getByLabelText("Previous match")).toBeDisabled();
    // The bar stays usable so the user can clear the query.
    expect(screen.getByLabelText("Search text in chat")).toBeEnabled();
  });

  it("navigates the match's row: reveals it and marks the chat scrolled-up first", async () => {
    const onRevealMessage = vi.fn();
    const onBeforeScroll = vi.fn();
    render(
      <Harness
        messages={[agent("a1", "needle one"), agent("a2", "needle two")]}
        onRevealMessage={onRevealMessage}
        onBeforeScroll={onBeforeScroll}
      />,
    );

    await typeQuery("needle");
    await waitFor(() => expect(countText()).toBe("1/2"));
    fireEvent.keyDown(screen.getByLabelText("Search text in chat"), {
      key: "Enter",
    });
    await waitFor(() => expect(countText()).toBe("2/2"));
    expect(onRevealMessage).toHaveBeenLastCalledWith("a2");
    expect(onBeforeScroll).toHaveBeenCalled();
  });

  it("closes on Escape and clears the query", async () => {
    render(<Harness messages={[agent("a1", "needle")]} />);
    await typeQuery("needle");
    await waitFor(() => expect(countText()).toBe("1/1"));

    fireEvent.keyDown(screen.getByLabelText("Search text in chat"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByRole("search")).not.toBeInTheDocument(),
    );

    // Reopening starts from a clean slate.
    fireEvent.click(screen.getByLabelText("Search in chat"));
    const reopened = (await screen.findByLabelText(
      "Search text in chat",
    )) as HTMLInputElement;
    expect(reopened.value).toBe("");
    expect(countText()).toBe("0/0");
  });

  it("closes from the close button", async () => {
    render(<Harness messages={[agent("a1", "needle")]} />);
    fireEvent.click(screen.getByLabelText("Close search"));
    await waitFor(() =>
      expect(screen.queryByRole("search")).not.toBeInTheDocument(),
    );
  });
});
