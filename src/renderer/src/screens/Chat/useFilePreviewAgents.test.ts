import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFilePreviewAgents } from "./useFilePreviewAgents";

const children = [1, 2, 3, 4].map((n) => ({
  subagent_id: `a${n}`,
  child_session_id: `s${n}`,
  last_tool: "patch",
}));
afterEach(() => vi.useRealTimers());

it("loads four bounded child tails sequentially, never resumes runtimes, stops when disabled", async () => {
  const read = vi.fn(async (id: string) => ({
    items: [
      {
        id: 1,
        kind: "tool_call" as const,
        callId: id,
        name: "patch",
        args: JSON.stringify({ path: `${id}.ts` }),
      },
    ],
    hasMore: false,
    oldestId: 1,
    newestId: 1,
  }));
  Object.assign(window, {
    hermesAPI: { ...window.hermesAPI, getSessionMessagesBefore: read },
  });
  const { result, rerender, unmount } = renderHook(
    ({ enabled }) => useFilePreviewAgents(children, enabled, "parent"),
    { initialProps: { enabled: true } },
  );
  await waitFor(() =>
    expect(result.current.every((agent) => agent.messages.length === 1)).toBe(
      true,
    ),
  );
  expect(read.mock.calls.map((args) => args[0])).toEqual([
    "s1",
    "s2",
    "s3",
    "s4",
  ]);
  expect(read).toHaveBeenCalledWith("s1", undefined, 60);
  rerender({ enabled: false });
  read.mockClear();
  vi.useFakeTimers();
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });
  expect(read).not.toHaveBeenCalled();
  unmount();
});

it("discards late responses after a session switch and never exposes another parent's tail", async () => {
  let release!: (value: unknown) => void;
  const read = vi.fn(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  Object.assign(window, {
    hermesAPI: { ...window.hermesAPI, getSessionMessagesBefore: read },
  });
  const { result, rerender } = renderHook(
    ({ session }) => useFilePreviewAgents(children.slice(0, 1), true, session),
    { initialProps: { session: "old" } },
  );
  const oldRelease = release;
  rerender({ session: "new" });
  await act(async () => {
    oldRelease({ items: [{ id: 1, kind: "assistant", content: "old" }] });
  });
  expect(result.current[0].messages).toEqual([]);
});
