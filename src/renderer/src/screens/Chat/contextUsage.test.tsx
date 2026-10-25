import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import chatSource from "./Chat.tsx?raw";
import { ContextGauge, type ContextUsage } from "./ContextGauge";
import type { UsageState } from "./types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

// Exercise the repository-owned Chat expression, never user/runtime strings.
// No untrusted input can reach this test-only Function body.
const expression = chatSource.match(/const contextUsage: ContextUsage(?: \| null)? = ([\s\S]*?);\r?\n/)?.[1];
if (!expression) throw new Error("Chat contextUsage expression not found");
const resolveUsage = new Function("usage", "realContextWindow", "chatCurrentModel", "localContextTokens", "contextWindowForModel", `return (${expression});`) as (
  usage: UsageState | null, window: number | null, model: string, local: number,
  heuristic: (model: string) => number,
) => ContextUsage;

it("shows local occupancy with a fetched limit before any model response", () => {
  const props = resolveUsage(null, 100000, "model", 250, () => 32000);
  expect(props).toMatchObject({ used: 250, window: 100000, estimated: true });
  render(<ContextGauge {...props} />);
  expect(screen.getByRole("button", { name: "Context usage: estimated 0%" })).toBeTruthy();
});

it("shows a fresh empty session immediately using the local model limit fallback", () => {
  const props = resolveUsage(null, null, "model", 0, () => 32000);
  expect(props).toMatchObject({ used: 0, window: 32000, estimated: true });
  render(<ContextGauge {...props} />);
  expect(screen.queryByRole("button", { name: "Context usage: unknown" })).toBeNull();
  expect(screen.getByRole("button", { name: "Context usage: estimated 0%" })).toBeTruthy();
});

it("prefers reported occupancy and window, including zero", () => {
  const usage: UsageState = { promptTokens: 1000, completionTokens: 20, totalTokens: 1020,
    contextTokens: 0, contextWindowTokens: 200000, cacheReadTokens: 10 };
  const props = resolveUsage(usage, 100000, "model", 250, () => 32000);
  expect(props).toMatchObject({ used: 0, window: 200000, estimated: false, cacheReadTokens: 10 });
});

it("switches from local occupancy to reported usage without remounting the gauge", () => {
  const view = render(<ContextGauge {...resolveUsage(null, 100000, "model", 25000, () => 32000)} />);
  expect(screen.getByRole("button", { name: "Context usage: estimated 25%" })).toBeTruthy();
  const usage: UsageState = { promptTokens: 50000, completionTokens: 10, totalTokens: 50010, contextTokens: 50000 };
  view.rerender(<ContextGauge {...resolveUsage(usage, 100000, "model", 25000, () => 32000)} />);
  expect(screen.getByRole("button", { name: "Context usage: 50%" })).toBeTruthy();
});
