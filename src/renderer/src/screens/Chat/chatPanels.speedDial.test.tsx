// @vitest-environment jsdom
// Unit tests for the two new UI features:
//   1. OnFinishBanner — keyboard shortcut banner
//   2. SpeedDialFAB — speed-dial wrapper for the floating rail

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { OnFinishBanner } from "./OnFinishBanner";
import { SpeedDialFAB } from "./SpeedDialFAB";

// Minimal hermesAPI stub.
const terminalWrite = vi.fn().mockResolvedValue({ ok: true });
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).hermesAPI = { terminalWrite };

// ── OnFinishBanner ──────────────────────────────────────────────────────────

describe("OnFinishBanner", () => {
  beforeEach(() => { terminalWrite.mockClear(); });

  it("renders nothing when not visible", () => {
    const { container } = render(
      <OnFinishBanner
        visible={false}
        sessionId="sess-1"
        onDismiss={() => {}}
        onRerun={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // @lat: [[chat-manual-tools#On-finish keyboard banner#Renders when visible]]
  it("renders buttons when visible", () => {
    render(
      <OnFinishBanner
        visible
        sessionId="sess-1"
        onDismiss={() => {}}
        onRerun={() => {}}
      />,
    );
    expect(screen.getByText(/Continue/)).toBeTruthy();
    expect(screen.getByText(/Interrupt/)).toBeTruthy();
    expect(screen.getByText(/Re-run/)).toBeTruthy();
  });

  // @lat: [[chat-manual-tools#On-finish keyboard banner#Enter sends newline]]
  it("Enter key sends \\n to terminal and dismisses", async () => {
    const onDismiss = vi.fn();
    render(
      <OnFinishBanner
        visible
        sessionId="sess-1"
        onDismiss={onDismiss}
        onRerun={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(terminalWrite).toHaveBeenCalledWith({ id: "sess-1", data: "\n" });
    expect(onDismiss).toHaveBeenCalled();
  });

  // @lat: [[chat-manual-tools#On-finish keyboard banner#N sends SIGINT]]
  it("N key sends Ctrl-C to terminal and dismisses", async () => {
    const onDismiss = vi.fn();
    render(
      <OnFinishBanner
        visible
        sessionId="sess-2"
        onDismiss={onDismiss}
        onRerun={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "n" });
    });
    expect(terminalWrite).toHaveBeenCalledWith({ id: "sess-2", data: "\x03" });
    expect(onDismiss).toHaveBeenCalled();
  });

  // @lat: [[chat-manual-tools#On-finish keyboard banner#R triggers rerun]]
  it("R key dismisses and calls onRerun", async () => {
    const onDismiss = vi.fn();
    const onRerun = vi.fn();
    render(
      <OnFinishBanner
        visible
        sessionId="sess-3"
        onDismiss={onDismiss}
        onRerun={onRerun}
      />,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "r" });
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onRerun).toHaveBeenCalled();
    // R does NOT send to terminal.
    expect(terminalWrite).not.toHaveBeenCalled();
  });

  // @lat: [[chat-manual-tools#On-finish keyboard banner#Escape dismisses]]
  it("Escape dismisses without terminal write", async () => {
    const onDismiss = vi.fn();
    render(
      <OnFinishBanner
        visible
        sessionId="sess-1"
        onDismiss={onDismiss}
        onRerun={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(terminalWrite).not.toHaveBeenCalled();
  });

  it("click Continue sends \\n", async () => {
    const onDismiss = vi.fn();
    render(
      <OnFinishBanner
        visible
        sessionId="sess-1"
        onDismiss={onDismiss}
        onRerun={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText(/Continue/));
    });
    expect(terminalWrite).toHaveBeenCalledWith({ id: "sess-1", data: "\n" });
    expect(onDismiss).toHaveBeenCalled();
  });
});

// ── SpeedDialFAB ────────────────────────────────────────────────────────────

describe("SpeedDialFAB", () => {
  const items = [
    { key: "a", element: <button>Tool A</button> },
    { key: "b", element: <button>Tool B</button> },
  ];

  // @lat: [[chat-manual-tools#Speed-dial FAB#Collapsed by default]]
  it("starts collapsed — items hidden", () => {
    const { container } = render(<SpeedDialFAB items={items} />);
    // The .speed-dial-items element must NOT have the open class.
    expect(container.querySelector(".speed-dial--open")).toBeNull();
  });

  // @lat: [[chat-manual-tools#Speed-dial FAB#Expands on FAB click]]
  it("expands on FAB click, shows items", async () => {
    const { container } = render(<SpeedDialFAB items={items} />);
    const fab = container.querySelector(".speed-dial-fab") as HTMLElement;
    await act(async () => { fireEvent.click(fab); });
    expect(container.querySelector(".speed-dial--open")).toBeTruthy();
  });

  // @lat: [[chat-manual-tools#Speed-dial FAB#Collapses on second FAB click]]
  it("collapses on second FAB click", async () => {
    const { container } = render(<SpeedDialFAB items={items} />);
    const fab = container.querySelector(".speed-dial-fab") as HTMLElement;
    await act(async () => { fireEvent.click(fab); });
    await act(async () => { fireEvent.click(fab); });
    expect(container.querySelector(".speed-dial--open")).toBeNull();
  });

  // @lat: [[chat-manual-tools#Speed-dial FAB#Escape closes]]
  it("Escape closes the expanded FAB", async () => {
    const { container } = render(<SpeedDialFAB items={items} />);
    const fab = container.querySelector(".speed-dial-fab") as HTMLElement;
    await act(async () => { fireEvent.click(fab); });
    expect(container.querySelector(".speed-dial--open")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(container.querySelector(".speed-dial--open")).toBeNull();
  });

  // @lat: [[chat-manual-tools#Speed-dial FAB#aria-expanded reflects state]]
  it("fab aria-expanded tracks open state", async () => {
    const { container } = render(<SpeedDialFAB items={items} />);
    const fab = container.querySelector(".speed-dial-fab") as HTMLElement;
    expect(fab.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { fireEvent.click(fab); });
    expect(fab.getAttribute("aria-expanded")).toBe("true");
  });
});

it("keeps FAB first and stable; Search clicks remain actions, outside clicks dismiss", () => {
  const search = vi.fn();
  const { container } = render(<SpeedDialFAB items={[{ key: "search", element: <button onClick={search}>Search</button> }]} />);
  const trigger = screen.getByRole("button", { name: "Expand tools" });
  const tools = container.querySelector(".speed-dial-items")!;
  expect(container.querySelector(".speed-dial")?.firstElementChild).toBe(trigger);
  expect(tools.hasAttribute("inert")).toBe(true);
  fireEvent.click(trigger);
  expect(tools.hasAttribute("inert")).toBe(false);
  const action = screen.getByRole("button", { name: "Search" });
  fireEvent.pointerDown(action);
  fireEvent.click(action);
  expect(search).toHaveBeenCalledTimes(1);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector(".speed-dial")?.firstElementChild).toBe(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(tools.hasAttribute("inert")).toBe(true);
});
