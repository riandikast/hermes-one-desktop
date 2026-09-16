import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useActiveSubagents } from "./useActiveSubagents";

afterEach(() => vi.useRealTimers());

it("tracks unique running children, ignores queued/foreign events, retains them after parent completion", () => {
  const runtimeSessionIdRef = { current: "parent" };
  const clientRef = { current: null };
  const { result } = renderHook(() =>
    useActiveSubagents(true, runtimeSessionIdRef, clientRef),
  );
  const event = (
    type: string,
    id = "one",
    session = "parent",
    status?: string,
  ) =>
    act(() =>
      result.current.onSubagentEvent({
        type,
        session_id: session,
        payload: { subagent_id: id, status },
      }),
    );
  event("subagent.spawn_requested");
  event("subagent.start", "foreign", "other");
  expect(result.current.activeSubagents).toEqual([]);
  event("subagent.start");
  event("subagent.start");
  event("subagent.tool");
  event("message.complete");
  event("subagent.complete", "one", "other");
  act(() =>
    result.current.onSubagentEvent({
      type: "subagent.start",
      session_id: "parent",
      payload: { subagent_id: 3 },
    }),
  );
  expect(
    result.current.activeSubagents.map((child) => child.subagent_id),
  ).toEqual(["one"]);
  for (const status of [
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "error",
    undefined,
  ]) {
    event("subagent.start");
    event("subagent.complete", "one", "parent", status);
    expect(result.current.activeSubagents).toEqual([]);
  }
});

it("recovers while idle, keeps known children on failure, rejects stale session and event snapshots", async () => {
  vi.useFakeTimers();
  const runtimeSessionIdRef = { current: "parent" };
  const request = vi
    .fn()
    .mockResolvedValue({
      subagents: [
        { subagent_id: "one", parent_id: "parent", status: "running" },
      ],
    });
  const clientRef = { current: { request } };
  const { result, rerender } = renderHook(() =>
    useActiveSubagents(true, runtimeSessionIdRef, clientRef),
  );
  await act(async () => {});
  expect(request).toHaveBeenCalledWith("subagent.list", {
    session_id: "parent",
  });
  expect(result.current.activeSubagents).toHaveLength(1);
  request.mockResolvedValueOnce({ error: "unavailable" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current.activeSubagents).toHaveLength(1);
  request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current.activeSubagents).toHaveLength(1);
  let resolve!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  act(() =>
    result.current.onSubagentEvent({
      type: "subagent.complete",
      session_id: "parent",
      payload: { subagent_id: "one" },
    }),
  );
  await act(async () => {
    resolve({
      subagents: [
        { subagent_id: "one", status: "running" },
        { subagent_id: "two", status: "running" },
      ],
    });
  });
  expect(
    result.current.activeSubagents.map((child) => child.subagent_id),
  ).toEqual(["two"]);
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  runtimeSessionIdRef.current = "other";
  rerender();
  await act(async () => {
    resolve({ subagents: [{ subagent_id: "stale", status: "running" }] });
  });
  expect(result.current.activeSubagents).toEqual([]);
  request.mockResolvedValue({ subagents: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(request).toHaveBeenLastCalledWith("subagent.list", {
    session_id: "other",
  });
  expect(result.current.activeSubagents).toEqual([]);
});
