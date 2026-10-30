import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolEntryProvider } from "./ToolEntryProvider";
import { ToolActivityGroup, setChatDisplayControls } from "./HistoryRow";
import { MessageList } from "./MessageList";
import type { ToolCallMessage } from "./types";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const call = (id: string): ToolCallMessage => ({ id, role: "agent", kind: "tool_call", name: "terminal", callId: id, args: '{"command":"pwd"}', status: "completed" });
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  setChatDisplayControls({ tools: "unset" });
  localStorage.setItem("hermes.autoExpandToolCalls", "true");
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  localStorage.removeItem("hermes.autoExpandToolCalls");
});
function transcript(messages: ToolCallMessage[], active = true, sessionKey = "parent"): React.JSX.Element {
  return <ToolEntryProvider active={active} sessionKey={sessionKey} messages={messages}>{messages.length > 0 && <ToolActivityGroup key={sessionKey} items={messages} />}</ToolEntryProvider>;
}
it("wires tab activation through the real transcript for parent and subagent sessions", () => {
  const messages = [call("transcript-parent")];
  const props = { messages, active: true, sessionKey: "parent", isLoading: false, toolProgress: null, onApprove: vi.fn(), onDeny: vi.fn(), onClarifyResolved: vi.fn() };
  const view = render(<MessageList {...props} />);
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(1);
  view.rerender(<MessageList {...props} active={false} />);
  const background = [...messages, call("transcript-background")];
  view.rerender(<MessageList {...props} messages={background} active={false} />);
  view.rerender(<MessageList {...props} messages={background} />);
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(2);
  view.rerender(<MessageList {...props} sessionKey="subagent" messages={[call("transcript-child")]} />);
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(1);
  expect([...view.container.querySelectorAll(".chat-tool-collapse")].every((panel) => panel.getAttribute("data-instant") === "true")).toBe(true);
});
it("opens every existing tool body on first paint without timers or stagger", () => {
  const messages = Array.from({ length: 20 }, (_, index) => call(`entry-${index}`));
  const view = render(transcript(messages));
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(20);
  const panels = [...view.container.querySelectorAll<HTMLElement>(".chat-tool-collapse")];
  expect(panels.every((panel) => panel.classList.contains("chat-tool-collapse--open") && panel.dataset.instant === "true" && !panel.style.transitionDelay)).toBe(true);
  expect(frames).toHaveLength(0);
});
it("settles returning tabs including background arrivals, but animates subsequent live tools", () => {
  const original = call("return-original"); const background = call("return-background"); const live = call("return-live");
  const view = render(transcript([original]));
  view.rerender(transcript([original], false));
  view.rerender(transcript([original, background], false));
  view.rerender(transcript([original, background], true));
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(2);
  view.rerender(transcript([original, background, live], true));
  const panels = view.container.querySelectorAll<HTMLElement>(".chat-tool-item .chat-tool-collapse");
  expect(panels[2].dataset.instant).toBeUndefined();
  expect(panels[2]).not.toHaveClass("chat-tool-collapse--open");
  for (let i = 0; vi.getTimerCount() && i < 20; i++) act(() => vi.advanceTimersToNextTimer());
  for (let i = 0; i < 3; i++) act(() => { const next = frames; frames = []; next.forEach((frame) => frame(0)); });
  expect(panels[2]).toHaveClass("chat-tool-collapse--open");
});
it("settles subagent session entry and later history hydration without changing manual collapse", () => {
  const view = render(transcript([], true, "subagent"));
  view.rerender(transcript([call("child-tool")], true, "subagent"));
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(1);
  fireEvent.click(view.container.querySelector(".chat-tool-item-header")!);
  expect(view.container.querySelector(".chat-tool-item-header")).toHaveAttribute("aria-expanded", "false");
  view.rerender(transcript([call("child-tool")], false, "subagent"));
  view.rerender(transcript([call("child-tool")], true, "subagent"));
  expect(view.container.querySelector(".chat-tool-item-header")).toHaveAttribute("aria-expanded", "false");
  view.rerender(transcript([call("different-child")], true, "other-subagent"));
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(1);
});
