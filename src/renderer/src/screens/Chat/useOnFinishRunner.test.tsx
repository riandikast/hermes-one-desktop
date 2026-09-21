// @vitest-environment jsdom
//
// The On-Finish runner executes the queue SEQUENTIALLY IN SELECTION ORDER.
// These assert the two things that would silently break the feature: that the
// order is honoured (not list order, not parallel), and that a deleted command
// or a failed launch cannot wedge the queue.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOnFinishRunner } from "./useOnFinishRunner";
import type { OnFinishCommand } from "./onFinish";

const COMMANDS: OnFinishCommand[] = [
  { id: "a", name: "Alpha", command: "echo a", cwd: "/x" },
  { id: "b", name: "Beta", command: "echo b", cwd: "/x" },
  { id: "c", name: "Gamma", command: "echo c", cwd: "/x" },
];

function mockApi(
  impl?: (payload: { commandId: string }) => Promise<{ id: string }>,
): ReturnType<typeof vi.fn> {
  const run = vi.fn(
    impl ??
      ((payload: { commandId: string }) =>
        Promise.resolve({ id: `term-${payload.commandId}` })),
  );
  (window as unknown as { hermesAPI: unknown }).hermesAPI = { commandRun: run };
  return run;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useOnFinishRunner", () => {
  it("runs commands in SELECTION order, not list order", async () => {
    const run = mockApi();
    const attach = vi.fn();
    const { result } = renderHook(() => useOnFinishRunner(attach));

    await act(async () => {
      // Selection is c, a — deliberately different from COMMANDS order.
      await result.current.runQueue(["c", "a"], COMMANDS);
    });

    expect(run.mock.calls.map((c) => c[0].commandId)).toEqual(["c", "a"]);
    // The same order must reach the dock, so tabs match the queue.
    expect(attach.mock.calls.map((c) => c[0])).toEqual(["term-c", "term-a"]);
  });

  it("runs strictly sequentially — each launch starts after the previous resolves", async () => {
    const order: string[] = [];
    let resolveFirst: (() => void) | null = null;
    mockApi((payload) => {
      order.push(`start:${payload.commandId}`);
      if (payload.commandId === "a") {
        return new Promise((resolve) => {
          resolveFirst = () => {
            order.push("end:a");
            resolve({ id: "term-a" });
          };
        });
      }
      return Promise.resolve({ id: `term-${payload.commandId}` });
    });

    const { result } = renderHook(() => useOnFinishRunner(vi.fn()));
    let done: Promise<void> | null = null;
    await act(async () => {
      done = result.current.runQueue(["a", "b"], COMMANDS);
      // "b" must NOT have started while "a" is unresolved.
      await Promise.resolve();
      expect(order).toEqual(["start:a"]);
      resolveFirst!();
      await done;
    });
    expect(order).toEqual(["start:a", "end:a", "start:b"]);
  });

  it("skips commands that were deleted instead of failing", async () => {
    const run = mockApi();
    const { result } = renderHook(() => useOnFinishRunner(vi.fn()));

    await act(async () => {
      await result.current.runQueue(["gone", "b"], COMMANDS);
    });

    expect(run.mock.calls.map((c) => c[0].commandId)).toEqual(["b"]);
  });

  it("continues the queue after one launch fails", async () => {
    const run = mockApi((payload) => {
      if (payload.commandId === "a") return Promise.reject(new Error("nope"));
      return Promise.resolve({ id: `term-${payload.commandId}` });
    });
    const attach = vi.fn();
    const { result } = renderHook(() => useOnFinishRunner(attach));

    await act(async () => {
      await result.current.runQueue(["a", "b", "c"], COMMANDS);
    });

    // b and c still ran, in order, after a failed.
    expect(run.mock.calls.map((c) => c[0].commandId)).toEqual(["a", "b", "c"]);
    expect(attach.mock.calls.map((c) => c[0])).toEqual(["term-b", "term-c"]);
  });

  it("does not overlap queues when a second turn finishes mid-run", async () => {
    const run = mockApi();
    const { result } = renderHook(() => useOnFinishRunner(vi.fn()));

    await act(async () => {
      const first = result.current.runQueue(["a", "b"], COMMANDS);
      // Second trigger while the first is in flight must be ignored.
      const second = result.current.runQueue(["c"], COMMANDS);
      await Promise.all([first, second]);
    });

    expect(run.mock.calls.map((c) => c[0].commandId)).toEqual(["a", "b"]);
  });

  it("does nothing for an empty queue and reports idle", async () => {
    const run = mockApi();
    const { result } = renderHook(() => useOnFinishRunner(vi.fn()));

    await act(async () => {
      await result.current.runQueue([], COMMANDS);
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.total).toBe(0);
  });

  it("clears the running flag once the queue completes", async () => {
    mockApi();
    const { result } = renderHook(() => useOnFinishRunner(vi.fn()));

    await act(async () => {
      await result.current.runQueue(["a"], COMMANDS);
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(result.current.state.current).toBe(0);
  });
});
