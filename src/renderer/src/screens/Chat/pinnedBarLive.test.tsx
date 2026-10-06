import { act, render, screen } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PinnedMessagesBar } from "./MessageList";
import {
  readPinnedMessages,
  writePinnedMessages,
  pinnedPreview,
  type PinnedMessageRef,
} from "./pinnedMessages";
import type { ChatBubbleMessage } from "./types";

/**
 * Pinning must be LIVE.
 *
 * The reported bug: adding or removing a pin only took effect after closing and
 * reopening the tab. The cause was that Chat held the stored pins in a `useMemo`
 * keyed on the SESSION ID, so toggling a pin wrote the store and flipped the
 * message flag but never recomputed the list the floating bar renders from.
 *
 * These tests drive the same wiring Chat uses (pins in STATE, updated by the
 * toggle) and assert the bar re-renders on the toggle alone — no remount, no
 * session change in between.
 */
function Harness({ api }: { api: { renderCount: number } }): React.JSX.Element {
  const identity = "session-1";
  const [messages] = useState<ChatBubbleMessage[]>([
    { id: "m1", role: "user", content: "first question", pinned: false },
    { id: "m2", role: "agent", content: "an answer worth pinning" },
  ]);

  // Mirror Chat: STATE (not a session-keyed memo) so a toggle re-renders.
  const [pinnedRefs, setPinnedRefs] = useState<PinnedMessageRef[]>(() =>
    readPinnedMessages(identity),
  );

  useEffect(() => {
    setPinnedRefs(readPinnedMessages(identity));
  }, []);

  const handlePinToggle = useCallback(
    (msgId: string, pinned: boolean) => {
      const current = readPinnedMessages(identity);
      const next = pinned
        ? current.some((ref) => ref.id === msgId)
          ? current
          : [
              ...current,
              ((): PinnedMessageRef => {
                const target = messages.find((m) => m.id === msgId);
                return {
                  id: msgId,
                  role: target?.role === "user" ? "user" : "agent",
                  preview: pinnedPreview(String(target?.content ?? "")),
                };
              })(),
            ]
        : current.filter((ref) => ref.id !== msgId);
      writePinnedMessages(identity, next);
      setPinnedRefs(next);
    },
    [messages],
  );

  const pinnedMessages = pinnedRefs
    .map((ref) => messages.find((m) => m.id === ref.id))
    .filter((m): m is ChatBubbleMessage => Boolean(m));

  api.renderCount += 1;

  return (
    <div>
      <button type="button" onClick={() => handlePinToggle("m1", true)}>
        pin-m1
      </button>
      <button type="button" onClick={() => handlePinToggle("m2", true)}>
        pin-m2
      </button>
      <button type="button" onClick={() => handlePinToggle("m1", false)}>
        unpin-m1
      </button>
      {pinnedMessages.length > 0 && (
        <div className="chat-pinned-float">
          <PinnedMessagesBar
            messages={pinnedMessages}
            onUnpin={(id) => handlePinToggle(id, false)}
            className="chat-pinned-bar--floating"
          />
        </div>
      )}
    </div>
  );
}

describe("pinned bar updates live", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window, {
      hermesAPI: { copyToClipboard: async () => undefined },
    });
  });
  afterEach(() => localStorage.clear());

  it("shows the bar as soon as the FIRST pin is added — no remount", () => {
    const api = { renderCount: 0 };
    render(<Harness api={api} />);

    // Nothing pinned yet.
    expect(screen.queryByText("Pinned")).toBeNull();

    act(() => {
      screen.getByText("pin-m1").click();
    });

    // Same component instance (no remount / reopen) now renders the bar.
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("first question")).toBeTruthy();
  });

  it("adds a SECOND pin to the open bar immediately", () => {
    const api = { renderCount: 0 };
    render(<Harness api={api} />);

    act(() => screen.getByText("pin-m1").click());
    act(() => screen.getByText("pin-m2").click());

    expect(screen.getByText("first question")).toBeTruthy();
    expect(screen.getByText("an answer worth pinning")).toBeTruthy();
    // Count in the header reflects both.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("removes a pin from the bar immediately", () => {
    const api = { renderCount: 0 };
    render(<Harness api={api} />);

    act(() => screen.getByText("pin-m1").click());
    act(() => screen.getByText("pin-m2").click());
    expect(screen.getByText("first question")).toBeTruthy();

    act(() => screen.getByText("unpin-m1").click());
    expect(screen.queryByText("first question")).toBeNull();
    // The other pin survives.
    expect(screen.getByText("an answer worth pinning")).toBeTruthy();
  });

  it("hides the bar again once the last pin is removed", () => {
    const api = { renderCount: 0 };
    render(<Harness api={api} />);

    act(() => screen.getByText("pin-m1").click());
    expect(screen.getByText("Pinned")).toBeTruthy();

    act(() => screen.getByText("unpin-m1").click());
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("persists the toggle so a fresh mount still sees it", () => {
    const api = { renderCount: 0 };
    const view = render(<Harness api={api} />);
    act(() => screen.getByText("pin-m1").click());
    view.unmount();

    // A brand-new mount reads the store and renders the pinned row.
    render(<Harness api={api} />);
    expect(screen.getByText("first question")).toBeTruthy();
  });
});
