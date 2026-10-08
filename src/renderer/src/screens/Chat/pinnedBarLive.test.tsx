import { act, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/renderWithI18n";
import { useCallback, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinnedMessagesBar, PinnedMessageReader } from "./MessageList";
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
  // Which message the reader dialog shows — owned by the host, like Chat.
  const [readerId, setReaderId] = useState<string | null>(null);

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
            onOpenMessage={setReaderId}
            className="chat-pinned-bar--floating"
          />
        </div>
      )}
      {/* Host-level mount, mimicking Chat: a SIBLING of the float container. */}
      <PinnedMessageReader
        message={pinnedMessages.find((m) => m.id === readerId) ?? null}
        onClose={() => setReaderId(null)}
      />
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
    renderWithI18n(<Harness api={api} />);

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
    renderWithI18n(<Harness api={api} />);

    act(() => screen.getByText("pin-m1").click());
    act(() => screen.getByText("pin-m2").click());

    expect(screen.getByText("first question")).toBeTruthy();
    expect(screen.getByText("an answer worth pinning")).toBeTruthy();
    // Count in the header reflects both.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("removes a pin from the bar immediately", () => {
    const api = { renderCount: 0 };
    renderWithI18n(<Harness api={api} />);

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
    renderWithI18n(<Harness api={api} />);

    act(() => screen.getByText("pin-m1").click());
    expect(screen.getByText("Pinned")).toBeTruthy();

    act(() => screen.getByText("unpin-m1").click());
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("persists the toggle so a fresh mount still sees it", () => {
    const api = { renderCount: 0 };
    const view = renderWithI18n(<Harness api={api} />);
    act(() => screen.getByText("pin-m1").click());
    view.unmount();

    // A brand-new mount reads the store and renders the pinned row.
    renderWithI18n(<Harness api={api} />);
    expect(screen.getByText("first question")).toBeTruthy();
  });
});

describe("pinned reader opens as a host-level dialog", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window, {
      hermesAPI: { copyToClipboard: async () => undefined },
    });
  });
  afterEach(() => localStorage.clear());

  const openReader = (): void => {
    act(() => screen.getByText("pin-m1").click());
    act(() => {
      screen.getByLabelText("Show full").click();
    });
  };

  it("opens the reader dialog from the pinned bar", () => {
    renderWithI18n(<Harness api={{ renderCount: 0 }} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    openReader();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Full text is shown, not the bar's clamped preview.
    expect(
      screen.getByText("first question", { selector: "pre" }),
    ).toBeTruthy();
  });

  it("renders the reader OUTSIDE the pinned bar's container", () => {
    // THE bug: the dialog used to be a child of `.chat-pinned-float`, so its
    // `position: fixed` overlay resolved against that absolutely-positioned
    // ~360px box (a "side mini dialog"). As a sibling it escapes to the
    // viewport, like the last-prompt reader.
    renderWithI18n(<Harness api={{ renderCount: 0 }} />);
    openReader();

    const dialog = screen.getByRole("dialog");
    const float = document.querySelector(".chat-pinned-float");
    expect(float).not.toBeNull();
    expect(float!.contains(dialog)).toBe(false);
  });

  it("closes the reader on request", () => {
    renderWithI18n(<Harness api={{ renderCount: 0 }} />);
    openReader();
    expect(screen.getByRole("dialog")).toBeTruthy();

    act(() => {
      screen.getByLabelText("Close Pinned — You").click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copies the pinned message's full text", async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(window, { hermesAPI: { copyToClipboard } });

    renderWithI18n(<Harness api={{ renderCount: 0 }} />);
    openReader();

    await act(async () => {
      screen.getByLabelText("Copy message").click();
    });
    expect(copyToClipboard).toHaveBeenCalledWith("first question");
  });
});
