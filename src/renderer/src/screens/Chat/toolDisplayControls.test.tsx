// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolActivityGroup, setChatDisplayControls } from "./HistoryRow";
import type { ToolResultMessage } from "./types";
import * as formatter from "./toolResultFormat";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

let serial = 0;
function rows(count: number): ToolResultMessage[] {
  return Array.from({ length: count }, () => ({
    id: `bulk-${serial++}`,
    kind: "tool_result",
    role: "agent",
    callId: "",
    name: "terminal",
    content: JSON.stringify({
      output: "synthetic output\n".repeat(50),
      exit_code: 0,
    }),
  }));
}
function drain(): void {
  for (let i = 0; vi.getTimerCount() && i < 2000; i++) {
    act(() => vi.advanceTimersToNextTimer());
  }
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  localStorage.clear();
  setChatDisplayControls({ tools: "unset" });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("does no result formatting in collapsed groups or collapsed items", () => {
  const format = vi.spyOn(formatter, "formatToolResult");
  const { container } = render(<ToolActivityGroup items={rows(20)} />);
  drain();
  expect(container.querySelectorAll(".chat-tool-item")).toHaveLength(0);
  expect(format).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector(".chat-tool-group-summary")!);
  drain();
  expect(container.querySelectorAll(".chat-tool-item")).toHaveLength(20);
  expect(format).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector(".chat-tool-item-header")!);
  drain();
  expect(format).toHaveBeenCalledTimes(1);
});

it("bounds bulk mounting across groups and lets hide cancel pending show", () => {
  const format = vi.spyOn(formatter, "formatToolResult");
  const { container } = render(
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <ToolActivityGroup key={i} items={rows(20)} />
      ))}
    </>,
  );
  act(() => setChatDisplayControls({ tools: "show" }));
  expect(format).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) {
    const before = format.mock.calls.length;
    act(() => vi.advanceTimersToNextTimer());
    expect(format.mock.calls.length - before).toBeLessThanOrEqual(1);
  }
  expect(format.mock.calls.length).toBeGreaterThan(0);
  act(() => setChatDisplayControls({ tools: "hide" }));
  const before = format.mock.calls.length;
  drain();
  expect(format).toHaveBeenCalledTimes(before);
  expect(container.querySelectorAll(".chat-tool-item-body")).toHaveLength(0);
  expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
  act(() => setChatDisplayControls({ tools: "show" }));
  drain();
  expect(container.querySelectorAll(".chat-tool-item-body")).toHaveLength(160);
});

it("honors modes for streamed rows and preserves manual overrides on remount", () => {
  localStorage.setItem("hermes.autoExpandToolCalls", "true");
  const items = rows(2);
  act(() => setChatDisplayControls({ tools: "hide" }));
  const view = render(<ToolActivityGroup items={items} active />);
  drain();
  expect(view.container.querySelector('[aria-expanded="true"]')).toBeNull();
  act(() => setChatDisplayControls({ tools: "show" }));
  drain();
  const added = rows(1);
  view.rerender(<ToolActivityGroup items={[...items, ...added]} active />);
  drain();
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(
    3,
  );
  fireEvent.click(view.container.querySelector(".chat-tool-item-header")!);
  drain();
  view.unmount();
  const remount = render(
    <ToolActivityGroup items={[...items, ...added]} active />,
  );
  drain();
  expect(
    remount.container.querySelector(".chat-tool-item-header"),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    remount.container.querySelectorAll(".chat-tool-item-body"),
  ).toHaveLength(2);
  act(() => setChatDisplayControls({ tools: "hide" }));
  remount.rerender(
    <ToolActivityGroup items={[...items, ...added, ...rows(1)]} active />,
  );
  drain();
  expect(remount.container.querySelector(".chat-tool-item")).toBeNull();
  fireEvent.click(remount.container.querySelector(".chat-tool-group-summary")!);
  drain();
  expect(
    remount.container.querySelectorAll(".chat-tool-item-header"),
  ).toHaveLength(4);
  expect(
    remount.container.querySelectorAll(".chat-tool-item-body"),
  ).toHaveLength(0);
});

it("cancels queued mounts on unmount and keeps collapsed streaming cheap", () => {
  const format = vi.spyOn(formatter, "formatToolResult");
  const items = rows(12);
  const view = render(<ToolActivityGroup items={items} active />);
  view.rerender(<ToolActivityGroup items={[...items, ...rows(1)]} active />);
  drain();
  expect(format).not.toHaveBeenCalled();
  act(() => setChatDisplayControls({ tools: "show" }));
  view.unmount();
  drain();
  expect(format).not.toHaveBeenCalled();
});

it("measures the synthetic real-component mount and bulk-toggle path", () => {
  const format = vi.spyOn(formatter, "formatToolResult");
  const start = performance.now();
  const { container } = render(<ToolActivityGroup items={rows(160)} />);
  const mountMs = performance.now() - start;
  const collapsedFormats = format.mock.calls.length;
  const collapsedNodes = container.querySelectorAll("*").length;
  const toggleStart = performance.now();
  act(() => setChatDisplayControls({ tools: "show" }));
  const toggleMs = performance.now() - toggleStart;
  const immediateFormats = format.mock.calls.length - collapsedFormats;
  let maxSliceMs = 0;
  let slices = 0;
  while (vi.getTimerCount() && slices < 2000) {
    const start = performance.now();
    act(() => vi.advanceTimersToNextTimer());
    maxSliceMs = Math.max(maxSliceMs, performance.now() - start);
    slices++;
  }
  const hideStart = performance.now();
  act(() => setChatDisplayControls({ tools: "hide" }));
  const hideMs = performance.now() - hideStart;
  console.info(
    `SYNTHETIC_COMPONENT ${JSON.stringify({ mountMs, collapsedFormats, collapsedNodes, toggleMs, immediateFormats, maxSliceMs, slices, hideMs })}\n`,
  );
});
