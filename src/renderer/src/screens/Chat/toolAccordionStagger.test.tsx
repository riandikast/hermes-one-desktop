// @vitest-environment jsdom
//
// Stagger wiring for tool groups.
//
// MEASURED PROBLEM (real Chromium, see the notes in main.css): when a group and
// the items inside it all animate at once, the motion reads as one lump jump.
// A per-item stagger reduced the worst single-frame height step from 16px to
// ~10px and raised intermediate heights from 30 to 47.
//
// jsdom cannot measure layout, so these assert the WIRING that produces that
// effect: rAF is stubbed so the items actually reach their open state, then the
// resulting inline transition-delay is checked (present, progressive, capped,
// and absent on the first item).

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ToolActivityGroup } from "./HistoryRow";
import type { ToolCallMessage, ToolResultMessage } from "./types";

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("hermes.autoExpandToolCalls");
});

/** Flush the stubbed rAF queue repeatedly, as real frames would. */
function flushFrames(times = 4): void {
  for (let i = 0; i < times; i += 1) {
    const current = rafQueue;
    rafQueue = [];
    act(() => {
      current.forEach((cb) => cb(performance.now()));
    });
  }
}

function manyCalls(count: number): React.JSX.Element {
  const items: (ToolCallMessage | ToolResultMessage)[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push({
      id: `tc-${i}`,
      kind: "tool_call",
      role: "agent",
      callId: `c${i}`,
      name: "terminal",
      args: JSON.stringify({ command: `echo ${i}` }),
      status: "completed",
    });
    items.push({
      id: `tr-${i}`,
      kind: "tool_result",
      role: "agent",
      callId: `c${i}`,
      name: "terminal",
      content: JSON.stringify({ output: `out ${i}`, exit_code: 0 }),
    });
  }
  return <ToolActivityGroup items={items} />;
}

function itemCollapses(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      ".chat-tool-item .chat-tool-collapse",
    ),
  ];
}

describe("accordion stagger wiring", () => {
  it("leaves the FIRST item undelayed so opening feels immediate", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(manyCalls(3));
    flushFrames();

    const first = itemCollapses(container)[0];
    expect(first).toBeDefined();
    // A leading gap reads as jank, so index 0 must never be delayed.
    expect(first.style.transitionDelay).toBe("");
  });

  it("staggers subsequent items so they do not move in lockstep", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(manyCalls(4));
    flushFrames();

    // A call AND its result are each their own row, so 4 tool calls produce 8
    // items — the flat index is the visual position, which is what the stagger
    // must follow.
    const collapses = itemCollapses(container);
    expect(collapses.length).toBe(8);

    const delays = collapses.map((el) =>
      el.style.transitionDelay ? Number.parseFloat(el.style.transitionDelay) : 0,
    );
    // Ascending and non-zero after the first.
    expect(delays[0]).toBe(0);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(0);
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
    // And they are not all identical, which is the lockstep this fixes.
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it("caps the delay so a long list does not lag perceptibly", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(manyCalls(12));
    flushFrames();

    const delays = itemCollapses(container).map((el) =>
      el.style.transitionDelay ? Number.parseFloat(el.style.transitionDelay) : 0,
    );
    expect(delays.length).toBeGreaterThan(8);
    // Uncapped, the 24th row would wait ~0.92s. The cap holds it at 0.16s.
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.16);
  });

  it("does not delay anything while CLOSED", () => {
    // A delay on the way out would make collapsing feel sticky.
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(manyCalls(4));
    flushFrames();
    const opened = itemCollapses(container).filter(
      (el) => el.style.transitionDelay,
    );
    expect(opened.length).toBeGreaterThan(0);

    // Toggle every item closed, then confirm the delay is gone.
    const headers = [
      ...container.querySelectorAll<HTMLElement>(".chat-tool-item-header"),
    ];
    act(() => {
      headers.forEach((h) => h.click());
    });
    const stillDelayed = itemCollapses(container).filter(
      (el) => el.style.transitionDelay,
    );
    expect(stillDelayed.length).toBe(0);
  });

  it("keeps every item mounted regardless of stagger", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(manyCalls(4));
    flushFrames();
    // 4 calls + 4 results = 8 rows.
    expect(container.querySelectorAll(".chat-tool-item").length).toBe(8);
  });
});
