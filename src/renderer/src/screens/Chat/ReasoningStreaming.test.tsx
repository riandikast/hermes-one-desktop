import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReasoningRow } from "./HistoryRow";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows the same arriving reasoning within 50ms running or stopped, without a reveal backlog", () => {
  vi.useFakeTimers();
  const progress: Record<string, number[]> = {};
  for (const active of [true, false]) {
    const msg = { id: `schedule-${active}`, kind: "reasoning" as const, role: "agent" as const, text: "" };
    const view = render(<ReasoningRow msg={msg} active={active} showAvatar={false} />);
    const samples: number[] = [];
    for (let i = 1; i <= 10; i++) {
      view.rerender(<ReasoningRow msg={{ ...msg, text: "x".repeat(i * 200) }} active={active} showAvatar={false} />);
      act(() => { vi.advanceTimersByTime(20); });
      samples.push(view.container.querySelector(".chat-reasoning-text")?.textContent?.length ?? 0);
    }
    act(() => { vi.advanceTimersByTime(50); });
    samples.push(view.container.querySelector(".chat-reasoning-text")?.textContent?.length ?? 0);
    progress[String(active)] = samples;
    view.unmount();
  }
  (globalThis as unknown as { process: { stdout: { write: (text: string) => void } } }).process.stdout.write(`synthetic reasoning progress ${JSON.stringify(progress)}\n`);
  expect(progress.true.at(-1)).toBe(2000);
  expect(progress.false.at(-1)).toBe(2000);
  expect(progress.true[4]).toBeGreaterThanOrEqual(600);
});

it("flushes received text immediately on manual stop; leaves no reveal timer", () => {
  vi.useFakeTimers();
  const msg = { id: "manual-stop", kind: "reasoning" as const, role: "agent" as const, text: "x".repeat(2000) };
  const view = render(<ReasoningRow msg={msg} active showAvatar={false} />);
  view.rerender(<ReasoningRow msg={msg} active={false} showAvatar={false} />);
  expect(view.container.querySelector(".chat-reasoning-text")?.textContent).toBe(msg.text);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
