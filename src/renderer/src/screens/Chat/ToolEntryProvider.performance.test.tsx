import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToolEntryProvider } from "./ToolEntryProvider";
import { ToolActivityGroup, setChatDisplayControls } from "./HistoryRow";
import * as formatter from "./toolResultFormat";
import type { ToolResultMessage } from "./types";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });
it("yields between history bodies and does no repeated formatting on tab returns", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  localStorage.setItem("hermes.autoExpandToolCalls", "true");
  setChatDisplayControls({ tools: "unset" });
  const format = vi.spyOn(formatter, "formatToolResult");
  const messages: ToolResultMessage[] = Array.from({ length: 80 }, (_, index) => ({ id: `perf-${index}`, callId: `perf-${index}`, role: "agent", kind: "tool_result", name: "web_search", content: JSON.stringify({ content: "synthetic result\n".repeat(100) }) }));
  const tree = (active: boolean): React.JSX.Element => <ToolEntryProvider active={active} messages={messages}><ToolActivityGroup items={messages} /></ToolEntryProvider>;
  const start = performance.now();
  const view = render(tree(true));
  console.log(`synthetic history initial render ms=${(performance.now() - start).toFixed(1)} synchronous formats=${format.mock.calls.length}`);
  expect(format).not.toHaveBeenCalled();
  for (let index = 0; vi.getTimerCount() && index < 1000; index++) {
    const before = format.mock.calls.length;
    act(() => vi.advanceTimersToNextTimer());
    expect(format.mock.calls.length - before).toBeLessThanOrEqual(1);
  }
  expect(view.container.querySelectorAll(".chat-tool-item-body")).toHaveLength(80);
  const before = format.mock.calls.length;
  const switchStart = performance.now();
  view.rerender(tree(false)); view.rerender(tree(true));
  console.log(`synthetic tab return ms=${(performance.now() - switchStart).toFixed(1)} additional formats=${format.mock.calls.length - before}`);
  expect(format).toHaveBeenCalledTimes(before);
});
