import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { cancelTurn, explicitModelLimit, probeTurn, providerRetry } from "./providerRetry";
import { ProviderRetryStatus } from "./ProviderRetryStatus";
import { renderWithI18n } from "../../test/renderWithI18n";

afterEach(() => vi.useRealTimers());

it("accepts real retry diagnostics, rejects loading/prose, prefers structured delay", () => {
  const text = "⏳ waiting on provider — retrying in 300s (attempt 1/3)";
  expect(providerRetry({ type: "thinking.delta", payload: { text } }, 1000)).toEqual({ deadline: 301000, attempt: "1/3" });
  expect(providerRetry({ type: "message.delta", payload: { text } }, 0)).toBeNull();
  expect(providerRetry({ type: "thinking.delta", payload: { text: "Waiting on provider" } }, 0)).toBeNull();
  expect(providerRetry({ type: "status.update", payload: { kind: "provider_retry", retry_after: 4, text } }, 0)?.deadline).toBe(4000);
  expect(explicitModelLimit("insufficient_quota")).toBe(true);
  expect(explicitModelLimit("daily limit reached")).toBe(true);
  expect(explicitModelLimit("connection timeout")).toBe(false);
});

it("counts down with fake time, resets from new event, never invents another retry", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const stop = vi.fn(async () => undefined);
  const { rerender } = renderWithI18n(<ProviderRetryStatus wait={{ deadline: 4000 }} onSwitch={stop} canSwitch />);
  expect(screen.getByRole("status").textContent).toContain("3s");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole("status").textContent).toContain("1s");
  rerender(<ProviderRetryStatus wait={{ deadline: 8000 }} onSwitch={stop} canSwitch />);
  expect(screen.getByRole("status").textContent).toContain("5s");
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(screen.getByRole("status").textContent).toContain("retry due");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch now" })); });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain("No replacement sent");
});

it.each(["working", "waiting", "starting", "unknown", "idle"])("probes %s without resending", async (status) => {
  const request = vi.fn(async (method: string) => method === "session.active_list" ? { sessions: [{ id: "live", status }] } : { subagents: [] });
  expect(await probeTurn(request, "live")).toBe(["working", "waiting", "starting"].includes(status) ? "running" : status === "idle" ? "idle" : "unknown");
  expect(request.mock.calls.some(([m]) => m === "prompt.submit")).toBe(false);
});

it("unknown/missing status and live children block cancellation confirmation", async () => {
  expect(await probeTurn(async () => ({}), "live")).toBe("unknown");
  expect(await probeTurn(async () => ({ sessions: [] }), "live")).toBe("unknown");
  const request = async (method: string) => method === "session.active_list" ? { sessions: [{ id: "live", status: "idle" }] } : { subagents: [{ status: "starting" }] };
  expect(await probeTurn(request, "live")).toBe("running");
});

it("interrupt ACK alone cannot authorize resend; delayed status must confirm idle", async () => {
  let release!: (v: unknown) => void;
  const pending = new Promise((r) => { release = r; });
  const request = vi.fn(async (method: string) => method === "session.interrupt" ? { status: "interrupted" } : method === "session.active_list" ? pending : { subagents: [] });
  let finished = false;
  const result = cancelTurn(request, "live", () => false).then((v) => { finished = true; return v; });
  await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(false);
  release({ sessions: [{ id: "live", status: "idle" }] });
  expect(await result).toBe(true);
});

it.each(["stop", "new prompt", "manual model switch"])("%s invalidates delayed cancellation", async () => {
  let invalid = false;
  let release!: (v: unknown) => void;
  const pending = new Promise((r) => { release = r; });
  const result = cancelTurn(async (m) => m === "session.interrupt" ? pending : { sessions: [{ id: "live", status: "idle" }], subagents: [] }, "live", () => invalid);
  invalid = true; release({ status: "interrupted" });
  expect(await result).toBe(false);
});
