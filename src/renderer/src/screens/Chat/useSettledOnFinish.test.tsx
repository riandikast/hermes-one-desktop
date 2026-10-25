// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSettledOnFinish,
  type OnFinishActivity,
} from "./useSettledOnFinish";
import { useOnFinishRunner } from "./useOnFinishRunner";
import { writeOnFinishSelection } from "./onFinish";
import { useActiveSubagents } from "./hooks/useActiveSubagents";

const commands = [
  { id: "a", command: "first" },
  { id: "b", command: "second" },
];
let activity: OnFinishActivity;
let commandRun: ReturnType<typeof vi.fn>;
let listCommands: ReturnType<typeof vi.fn>;
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
function setup(children = false) {
  const sessionRef = { current: "session" };
  const clientRef = {
    current: { request: vi.fn().mockResolvedValue({ subagents: [] }) },
  };
  return renderHook(
    ({ loading = true, active = true, identity = "session" }) => {
      const roster = useActiveSubagents(
        children,
        sessionRef,
        clientRef,
        active,
      );
      const runner = useOnFinishRunner(vi.fn());
      const cancel = useSettledOnFinish({
        loading,
        active,
        identity,
        armed: true,
        getActivity: () => ({
          ...activity,
          busy: activity.busy || roster.hasActiveSubagents(),
          revision: `${activity.revision}:${roster.getSubagentRevision()}`,
        }),
        runQueue: runner.runQueue,
      });
      return {
        cancel,
        event: roster.onSubagentEvent,
        request: clientRef.current.request,
      };
    },
    { initialProps: { loading: true, active: true, identity: "session" } },
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  writeOnFinishSelection(["b", "a"], "session");
  activity = { busy: false, cancelled: false, revision: "0" };
  commandRun = vi.fn().mockResolvedValue({ id: "terminal" });
  listCommands = vi.fn().mockResolvedValue(commands);
  Object.assign(window, { hermesAPI: { commandRun, listCommands } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("settled on-finish execution", () => {
  // @lat: [[chat-on-finish#Execution regressions]]
  it("waits for real child events, then exactly 3 seconds, once, in selection order", async () => {
    const { result, rerender } = setup(true);
    await advance(0);
    result.current.request.mockResolvedValue({
      subagents: [{ subagent_id: "child", status: "running" }],
    });
    act(() =>
      result.current.event({
        type: "subagent.start",
        session_id: "session",
        payload: { subagent_id: "child" },
      }),
    );
    rerender({ loading: false, active: true, identity: "session" });
    await advance(10000);
    expect(commandRun).not.toHaveBeenCalled();
    result.current.request.mockResolvedValue({ subagents: [] });
    act(() =>
      result.current.event({
        type: "subagent.complete",
        session_id: "session",
        payload: { subagent_id: "child" },
      }),
    );
    await advance(2999);
    expect(commandRun).not.toHaveBeenCalled();
    await advance(1);
    expect(commandRun.mock.calls.map(([p]) => p.commandId)).toEqual(["b"]);
    await advance(10000);
    expect(commandRun.mock.calls.map(([p]) => p.commandId)).toEqual(["b", "a"]);
  });

  it.each(["child", "processing", "retry", "background"])(
    "restarts the full idle window after %s",
    async (reason) => {
      const { rerender } = setup();
      rerender({ loading: false, active: true, identity: "session" });
      await advance(2000);
      activity = { ...activity, busy: true, revision: "1" };
      rerender({
        loading: reason === "processing",
        active: reason !== "background",
        identity: "session",
      });
      await advance(4000);
      expect(commandRun).not.toHaveBeenCalled();
      activity.busy = false;
      rerender({ loading: false, active: true, identity: "session" });
      await advance(2999);
      expect(commandRun).not.toHaveBeenCalled();
      await advance(1);
      expect(commandRun).toHaveBeenCalledTimes(1);
    },
  );

  it("rechecks live activity at the deadline, before React commits", async () => {
    const { rerender } = setup();
    rerender({ loading: false, active: true, identity: "session" });
    await advance(2999);
    activity.busy = true;
    await advance(1);
    expect(commandRun).not.toHaveBeenCalled();
    activity.busy = false;
    await advance(3099);
    expect(commandRun).not.toHaveBeenCalled();
    await advance(1);
    expect(commandRun).toHaveBeenCalledTimes(1);
  });

  it("invalidates asynchronous command lookup, then retries after settled idle", async () => {
    let resolve!: (value: typeof commands) => void;
    listCommands.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { rerender } = setup();
    rerender({ loading: false, active: true, identity: "session" });
    await advance(3000);
    activity.busy = true;
    await act(async () => {
      resolve(commands);
    });
    expect(commandRun).not.toHaveBeenCalled();
    activity.busy = false;
    await advance(3100);
    expect(commandRun).toHaveBeenCalledTimes(1);
  });

  it.each(["interrupt", "session", "unmount"])(
    "cancels stale work on %s without clearing selection",
    async (reason) => {
      const { result, rerender, unmount } = setup();
      rerender({ loading: false, active: true, identity: "session" });
      await advance(2000);
      if (reason === "interrupt") act(() => result.current.cancel());
      if (reason === "session")
        rerender({ loading: false, active: true, identity: "other" });
      if (reason === "unmount") unmount();
      await advance(10000);
      expect(commandRun).not.toHaveBeenCalled();
      expect(
        localStorage.getItem("hermes.onFinish.selectedCommands.session"),
      ).toContain('"b"');
    },
  );

  it("rejects an interrupted loading transition and permits a new run", async () => {
    const { rerender } = setup();
    activity.cancelled = true;
    rerender({ loading: false, active: true, identity: "session" });
    await advance(4000);
    expect(commandRun).not.toHaveBeenCalled();
    activity = { busy: false, cancelled: false, revision: "2" };
    rerender({ loading: true, active: true, identity: "session" });
    rerender({ loading: false, active: true, identity: "session" });
    await advance(3000);
    expect(commandRun).toHaveBeenCalledTimes(1);
  });
  it("resets for a child start/complete pair between timer ticks", async () => {
    const { result, rerender } = setup(true);
    await advance(0);
    rerender({ loading: false, active: true, identity: "session" });
    await advance(2900);
    act(() => {
      result.current.event({
        type: "subagent.start",
        session_id: "session",
        payload: { subagent_id: "child" },
      });
      result.current.event({
        type: "subagent.complete",
        session_id: "session",
        payload: { subagent_id: "child" },
      });
    });
    await advance(2999);
    expect(commandRun).not.toHaveBeenCalled();
    await advance(1);
    expect(commandRun).toHaveBeenCalledTimes(1);
  });

  it("defers unknown snapshots, then removes completed children absent from a snapshot", async () => {
    const { result, rerender } = setup(true);
    await advance(0);
    result.current.request.mockResolvedValue({
      subagents: [{ subagent_id: "child", status: "running" }],
    });
    act(() =>
      result.current.event({
        type: "subagent.start",
        session_id: "session",
        payload: { subagent_id: "child" },
      }),
    );
    rerender({ loading: false, active: false, identity: "session" });
    await advance(6000);
    expect(commandRun).not.toHaveBeenCalled();
    result.current.request.mockResolvedValue({ subagents: [] });
    rerender({ loading: false, active: true, identity: "session" });
    await advance(0);
    await advance(2999);
    expect(commandRun).not.toHaveBeenCalled();
    await advance(1);
    expect(commandRun).toHaveBeenCalledTimes(1);
  });

  it("does not treat a legacy Stop loading transition as completion", async () => {
    const { result, rerender } = setup();
    act(() => result.current.cancel());
    rerender({ loading: false, active: true, identity: "session" });
    await advance(10000);
    expect(commandRun).not.toHaveBeenCalled();
  });

  it("stops subsequent launches when work resumes during an ordered queue", async () => {
    const { rerender } = setup();
    rerender({ loading: false, active: true, identity: "session" });
    await advance(3000);
    activity.busy = true;
    await advance(1000);
    expect(commandRun.mock.calls.map(([p]) => p.commandId)).toEqual(["b"]);
  });
});
