// @vitest-environment jsdom
//
// The mid-turn DB poll must read and reconcile only the TAIL.
//
// ROOT CAUSE of the stutter: `useChatIPC`'s 750ms poll called
// `getSessionMessages(sessionId)` with NO cursor and merged with the full
// `reconcileAfterDbRefresh`. Measured against real session data:
//
//   full read  : ~180 ms of blocking SQLite on a 21k-row session
//   tail read  : ~0.2 ms with an id cursor
//
// At 750ms cadence that stalled the main thread ~240ms/sec, which is exactly
// the periodic stutter — worst during prompt processing because that is when
// this poll is active.
//
// These tests pin the two halves of the fix: the cursor is passed to the IPC
// read, and the cursor is NOT advanced before the merge (advancing first makes
// the incoming rows look like already-settled prefix and drops them).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatIPC } from "./useChatIPC";

/** A DB row as the IPC returns it. `kind` (not just `role`) drives mapping. */
function row(
  id: number,
  kind: "user" | "assistant",
  content: string,
): { id: number; kind: string; role: string; content: string; timestamp: number } {
  return {
    id,
    kind,
    role: kind,
    content,
    timestamp: 1_700_000_000 + id,
  };
}

let getSessionMessages: ReturnType<typeof vi.fn>;
let sessionStartedCb: ((runId: string, sessionId: string) => void) | null;

beforeEach(() => {
  vi.useFakeTimers();
  sessionStartedCb = null;
  getSessionMessages = vi.fn().mockResolvedValue([]);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    getSessionMessages,
    onChatSessionStarted: (cb: (r: string, s: string) => void) => {
      sessionStartedCb = cb;
      return () => undefined;
    },
    // Every subscription the hook makes must exist, or the effect throws.
    onChatChunk: () => () => undefined,
    onChatDone: () => () => undefined,
    onChatError: () => () => undefined,
    onChatReasoningChunk: () => () => undefined,
    onChatToolEvent: () => () => undefined,
    onChatToolProgress: () => () => undefined,
    onChatUsage: () => () => undefined,
    onClarifyRequest: () => () => undefined,
    terminalWrite: vi.fn(),
  };
});

function mount(activeTurnStatus: "running" | null = "running") {
  const setMessages = vi.fn((updater: unknown) => {
    void updater;
  });
  const activeTurnRef = {
    current:
      activeTurnStatus === "running"
        ? ({ status: "running" } as never)
        : null,
  };
  const view = renderHook(() =>
    useChatIPC({
      runId: "run-1",
      sessionScopeId: null,
      setMessages: setMessages as never,
      setHermesSessionId: vi.fn(),
      setToolProgress: vi.fn(),
      setIsLoading: vi.fn(),
      setUsage: vi.fn(),
      activeTurnRef: activeTurnRef as never,
    }),
  );
  return { ...view, setMessages };
}

/** Start a session so the poller begins, then let one interval elapse. */
async function startSessionThenPoll(ms: number): Promise<void> {
  act(() => {
    sessionStartedCb?.("run-1", "session-a");
  });
  if (ms > 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  // Let the in-flight promise chain settle (the read is awaited).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("mid-turn DB poll is cursor-scoped", () => {
  it("passes NO cursor on the very first read", async () => {
    // Nothing has been merged yet, so there is no high-water mark to use and
    // the read must be unscoped to establish the baseline.
    mount();
    await startSessionThenPoll(0);

    expect(getSessionMessages).toHaveBeenCalled();
    const [, afterId] = getSessionMessages.mock.calls[0];
    expect(afterId).toBeUndefined();
  });

  it("uses the last merged id as the cursor on subsequent polls", async () => {
    getSessionMessages.mockResolvedValue([
      row(10, "user", "hi"),
      row(11, "assistant", "hello"),
    ]);
    mount();
    await startSessionThenPoll(750);

    // Wait for the merge to land so the cursor advances.
    await act(async () => {
      await Promise.resolve();
    });

    getSessionMessages.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(getSessionMessages).toHaveBeenCalled();
    const [, afterId] = getSessionMessages.mock.calls[0];
    // The high-water mark must be the newest id already merged.
    expect(afterId).toBe(11);
  });

  it("does not advance the cursor past rows it has not merged yet", async () => {
    // Guards the ordering bug: if the ref advanced BEFORE the merge, the merge
    // would receive the NEW id as its prefix boundary and treat the incoming
    // rows as already-settled, silently dropping them.
    getSessionMessages.mockResolvedValue([row(5, "user", "first")]);
    const { setMessages } = mount();
    await startSessionThenPoll(750);
    await act(async () => {
      await Promise.resolve();
    });

    // First merge happened with prev === [] (baseline), so no reconcile ran.
    expect(setMessages).toHaveBeenCalled();

    // Second poll returns fresh rows; the cursor handed to the reconcile must
    // be the PREVIOUS mark (5), not the new one.
    getSessionMessages.mockResolvedValue([row(6, "assistant", "second")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const afterId = getSessionMessages.mock.calls.at(-1)?.[1];
    expect(afterId).toBe(5);
  });

  it("stops polling once the turn reports done", async () => {
    // The poller is bounded by the turn lifecycle, not by the activeTurn ref:
    // it stops on onChatDone. When it runs, it must stop for real — an
    // unstopped poller is what made this a continuous stutter.
    let doneCb: ((runId: string) => void) | null = null;
    (window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI[
      "onChatDone"
    ] = (cb: (runId: string) => void) => {
      doneCb = cb;
      return () => undefined;
    };

    mount();
    await startSessionThenPoll(750);
    expect(getSessionMessages.mock.calls.length).toBeGreaterThan(0);

    act(() => {
      doneCb?.("run-1");
    });
    const atDone = getSessionMessages.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    // No further reads after the turn ends.
    expect(getSessionMessages.mock.calls.length).toBe(atDone);
  });

  it("does not stack reads while one is in flight", async () => {
    let resolveRead: ((v: unknown) => void) | null = null;
    getSessionMessages.mockImplementation(
      () =>
        new Promise((res) => {
          resolveRead = res;
        }),
    );
    mount();
    await startSessionThenPoll(750);

    const inFlight = getSessionMessages.mock.calls.length;
    // Several intervals elapse while the first read hangs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getSessionMessages.mock.calls.length).toBe(inFlight);

    await act(async () => {
      resolveRead?.([]);
      await Promise.resolve();
    });
  });

  it("tolerates a rejected read without breaking the poll loop", async () => {
    getSessionMessages.mockRejectedValueOnce(new Error("db locked"));
    mount();
    await startSessionThenPoll(750);

    getSessionMessages.mockResolvedValue([row(1, "user", "recovered")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(getSessionMessages.mock.calls.length).toBeGreaterThan(1);
  });
});
