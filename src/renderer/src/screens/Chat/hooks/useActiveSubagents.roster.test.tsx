import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useActiveSubagents } from "./useActiveSubagents";

afterEach(() => vi.useRealTimers());

/**
 * The roster used to require `status === "running"` AND a matching/absent
 * `parent_id`. Models that report `starting`/`queued` (or omit the status at
 * spawn) had their children silently hidden, so the loading indicator never
 * appeared even though subagents were clearly spawning.
 */
async function rosterFor(
  rows: Array<Record<string, unknown>>,
): Promise<string[]> {
  const runtimeSessionIdRef = { current: "parent" };
  const clientRef = {
    current: { request: vi.fn().mockResolvedValue({ subagents: rows }) },
  };
  const { result } = renderHook(() =>
    useActiveSubagents(true, runtimeSessionIdRef, clientRef),
  );
  await act(async () => {});
  return result.current.activeSubagents.map((c) => c.subagent_id);
}

describe("subagent roster status handling", () => {
  it("shows a child reported as running", async () => {
    expect(await rosterFor([{ subagent_id: "a", status: "running" }])).toEqual([
      "a",
    ]);
  });

  it("shows a child that is still starting", async () => {
    // The reported bug: spawn was visible in the transcript but not in the
    // indicator because the status had not flipped to "running" yet.
    expect(await rosterFor([{ subagent_id: "a", status: "starting" }])).toEqual(
      ["a"],
    );
  });

  it("shows a queued child", async () => {
    expect(await rosterFor([{ subagent_id: "a", status: "queued" }])).toEqual([
      "a",
    ]);
  });

  it("shows a child whose status is missing entirely", async () => {
    expect(await rosterFor([{ subagent_id: "a" }])).toEqual(["a"]);
  });

  it("shows a waiting child", async () => {
    expect(await rosterFor([{ subagent_id: "a", status: "waiting" }])).toEqual([
      "a",
    ]);
  });

  it.each([
    "complete",
    "completed",
    "done",
    "failed",
    "error",
    "cancelled",
    "canceled",
    "stopped",
  ])("hides a child reported as %s", async (status) => {
    expect(await rosterFor([{ subagent_id: "a", status }])).toEqual([]);
  });

  it("shows a nested child whose parent_id is a different session", async () => {
    // Grandchildren were filtered out by the old parent_id equality check.
    expect(
      await rosterFor([
        { subagent_id: "grandchild", parent_id: "some-other-child", status: "running" },
      ]),
    ).toEqual(["grandchild"]);
  });

  it("still shows a child with the parent's own id", async () => {
    expect(
      await rosterFor([{ subagent_id: "a", parent_id: "parent", status: "running" }]),
    ).toEqual(["a"]);
  });

  it("keeps the snapshot when the RPC response is malformed", async () => {
    const runtimeSessionIdRef = { current: "parent" };
    const clientRef = {
      current: { request: vi.fn().mockResolvedValue({ subagents: [] }) },
    };
    const { result } = renderHook(() =>
      useActiveSubagents(true, runtimeSessionIdRef, clientRef),
    );
    await act(async () => {});
    act(() =>
      result.current.onSubagentEvent({
        type: "subagent.start",
        session_id: "parent",
        payload: { subagent_id: "live" },
      }),
    );
    expect(result.current.activeSubagents.map((c) => c.subagent_id)).toEqual([
      "live",
    ]);

    // Malformed snapshot (no `subagents` array) must not clear the roster.
    clientRef.current.request.mockResolvedValueOnce({ error: "nope" });
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.activeSubagents.map((c) => c.subagent_id)).toEqual([
      "live",
    ]);
  });
});

/**
 * The "View" button needs `child_session_id`. It arrives on the
 * `subagent.start` event but is frequently ABSENT from `subagent.list`
 * snapshots — so the poll must merge onto the known row rather than replace it,
 * otherwise the id (and the button) is wiped on the very next tick.
 */
describe("useActiveSubagents — child_session_id preservation", () => {
  afterEach(() => vi.useRealTimers());

  function harness() {
    const runtimeSessionIdRef = { current: "parent" };
    const clientRef = {
      current: {
        request: vi.fn().mockResolvedValue({
          subagents: [{ subagent_id: "a", status: "running" }], // no child_session_id
        }),
      },
    };
    const { result } = renderHook(() =>
      useActiveSubagents(true, runtimeSessionIdRef, clientRef),
    );
    return { result, clientRef };
  }

  it("keeps a child_session_id learned from an event when the snapshot omits it", async () => {
    const { result, clientRef } = harness();
    await act(async () => {});

    // Event supplies the real child session id.
    act(() =>
      result.current.onSubagentEvent({
        type: "subagent.start",
        session_id: "parent",
        payload: { subagent_id: "a", child_session_id: "child-123" },
      }),
    );
    expect(result.current.activeSubagents[0]?.child_session_id).toBe("child-123");

    // The next poll returns a row WITHOUT child_session_id. Before the fix this
    // replaced the row outright and the id vanished.
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(clientRef.current.request).toHaveBeenCalled();
    expect(result.current.activeSubagents[0]?.child_session_id).toBe("child-123");
  });

  it("keeps the id across several snapshot ticks", async () => {
    // Real timers here on purpose. The hook's poll is guarded by a `busy` flag
    // set for the duration of each `subagent.list` round-trip; under fake
    // timers the interval ticks fire while `busy` is still true, so the poll
    // never actually re-runs and the assertion would pass even with the bug
    // present (verified: it did). Waiting real poll intervals is slower but it
    // genuinely exercises the snapshot-over-snapshot merge.
    const { result, clientRef } = harness();
    await act(async () => {});
    act(() =>
      result.current.onSubagentEvent({
        type: "subagent.start",
        session_id: "parent",
        payload: { subagent_id: "a", child_session_id: "child-xyz" },
      }),
    );
    const before = clientRef.current.request.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
    });
    // At least two full poll cycles happened...
    expect(clientRef.current.request.mock.calls.length).toBeGreaterThanOrEqual(
      before + 2,
    );
    // ...and the id survived every one of them, even though no snapshot ever
    // carried child_session_id.
    expect(result.current.activeSubagents[0]?.child_session_id).toBe("child-xyz");
  }, 20_000);
});
