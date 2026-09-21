import { act, render, waitFor } from "@testing-library/react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DashboardRpcEvent } from "../dashboardGatewayClient";
import {
  ensureDashboardRuntimeSession,
  useDashboardChatTransport,
} from "./useDashboardChatTransport";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";

type SetUsageMock = Mock<(value: SetStateAction<UsageState | null>) => void>;

const dashboardMock = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(async () => undefined),
  instances: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    connected: boolean;
    request: ReturnType<typeof vi.fn>;
  }>,
  onEvent: null as ((event: DashboardRpcEvent) => void) | null,
  request: vi.fn(),
}));

vi.mock("../dashboardGatewayClient", () => ({
  DashboardGatewayClient: class MockDashboardGatewayClient {
    close = dashboardMock.close;
    connect = dashboardMock.connect;
    connected = true;
    request = dashboardMock.request;

    constructor(
      options: { onEvent?: (event: DashboardRpcEvent) => void } = {},
    ) {
      dashboardMock.onEvent = options.onEvent ?? null;
      dashboardMock.instances.push(this);
    }
  },
}));

interface HarnessApi {
  activeSubagents?: { subagent_id: string }[];
  activeTurnRef?: MutableRefObject<ActiveTurn | null>;
  messages?: ChatMessage[];
  send?: (text: string) => Promise<boolean>;
  setConnectionMode?: Dispatch<SetStateAction<"local" | "remote" | "ssh">>;
  setMessages?: Dispatch<SetStateAction<ChatMessage[]>>;
  setModel?: Dispatch<SetStateAction<string>>;
  setPlanMode?: Dispatch<SetStateAction<boolean>>;
  setProvider?: Dispatch<SetStateAction<string>>;
}

const activeBadTurn: ActiveTurn = {
  startIndex: 0,
  status: "running",
  turnId: "turn-bad",
  userId: "u-bad",
};

const activeRecoveryTurn: ActiveTurn = {
  startIndex: 2,
  status: "running",
  turnId: "turn-recovery",
  userId: "u-recovery",
};

function Harness({
  active = true,
  api,
  fallbackOnUnavailable = false,
  initialConnectionMode = "local",
  initialPlanMode = false,
  onDashboardUnavailable,
  setUsage = vi.fn() as SetUsageMock,
}: {
  active?: boolean;
  api: HarnessApi;
  fallbackOnUnavailable?: boolean;
  initialConnectionMode?: "local" | "remote" | "ssh";
  initialPlanMode?: boolean;
  onDashboardUnavailable?: (reason: string) => void;
  setUsage?: SetUsageMock;
}): null {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "u-bad",
      role: "user",
      content: "bad provider turn",
      turnId: "turn-bad",
    },
  ]);
  const [model, setModel] = useState("bad-model");
  const [provider, setProvider] = useState("bad-provider");
  const [planMode, setPlanMode] = useState(initialPlanMode);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >(initialConnectionMode);
  const activeTurnRef = useRef<ActiveTurn | null>({ ...activeBadTurn });
  const transport = useDashboardChatTransport({
    active,
    activeTurnRef,
    contextFolder: null,
    connectionMode,
    enabled: true,
    fallbackOnUnavailable,
    hermesSessionId: null,
    messages,
    model,
    planMode,
    profile: undefined,
    provider,
    setHermesSessionId: vi.fn(),
    setIsLoading: vi.fn(),
    setMessages,
    setToolProgress: vi.fn(),
    setUsage,
    onDashboardUnavailable,
  });

  useEffect(() => {
    // Bridge the hook's live values out to the test via the shared `api`
    // object. Object.assign mutates it in place (same reference the test
    // holds) without per-prop assignment, which the immutability rule rejects.
    Object.assign(api, {
      activeTurnRef,
      messages,
      activeSubagents: transport.activeSubagents,
      send: transport.sendMessage,
      setConnectionMode,
      setMessages,
      setModel,
      setPlanMode,
      setProvider,
    });
  }, [
    activeTurnRef,
    api,
    messages,
    setConnectionMode,
    setMessages,
    transport.activeSubagents,
    transport.sendMessage,
  ]);

  return null;
}

describe("useDashboardChatTransport recovery", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        freshDashboardWsUrl: vi.fn(async () => "ws://fresh-dashboard"),
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
        getSessionMessages: vi.fn(async () => []),
      },
    });
  });

  it("retains the parent child roster after message.complete", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create" || method === "session.resume") return { session_id: "live", stored_session_id: "stored" };
      if (method === "model.options") return { model: "bad-model", provider: "bad-provider", providers: [] };
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => { await api.send?.("hello"); });
    expect(api.activeTurnRef?.current?.status).toBe("running");
    await act(async () => {
      dashboardMock.onEvent?.({ type: "subagent.start", session_id: "live", payload: { subagent_id: "child" } });
      dashboardMock.onEvent?.({ type: "message.complete", session_id: "live", payload: { content: "done" } });
    });
    expect(api.activeTurnRef?.current).toBeNull();
    expect(api.activeSubagents).toEqual([{ subagent_id: "child" }]);
  });

  it("tracks a foreign turn via session.active_list polling", async () => {
    vi.useFakeTimers();
    try {
      dashboardMock.request.mockImplementation(async (method) => {
        if (method === "session.create") {
          return { session_id: "live", stored_session_id: "stored" };
        }
        if (method === "model.options") {
          // Match the harness model, or ensureSelectedModel resets the runtime
          // session (close + resume) and the poller never re-arms. Regression
          // guard: this mock line went missing and silently killed this test
          // for weeks (see the harness-repair note in the gate test below).
          return { model: "bad-model", provider: "bad-provider", providers: [] };
        }
        if (method === "session.active_list") {
          return { sessions: [{ id: "live", status: "working" }] };
        }
        return {};
      });
      const api: HarnessApi = {};
      render(<Harness api={api} initialConnectionMode="local" />);

      await act(async () => {
        await api.send?.("hello");
      });
      // End the local turn so activeTurnRef is clear — foreign tracking only
      // applies when no LOCAL turn owns the UI.
      await act(async () => {
        dashboardMock.onEvent?.({
          type: "message.complete",
          payload: { content: "done" },
          session_id: "live",
        });
      });

      // A foreign writer (another app) is streaming a turn on this session —
      // the poller must see status=working, enter foreign mode and pull the
      // canonical rows.
      const getMessages = vi.fn(async () => []);
      (window.hermesAPI as unknown as { getSessionMessages: typeof getMessages }).getSessionMessages = getMessages;
      await act(async () => {
        // Advance past BOTH the 2s poll interval AND the 5s post-local-turn
        // grace window (a local message.complete just stamped activity).
        vi.advanceTimersByTime(7200);
      });
      expect(dashboardMock.request).toHaveBeenCalledWith("session.active_list");
      // The reconcile reads the TAIL slice since ff2883fa: (stored, afterId).
      expect(getMessages).toHaveBeenCalledWith("stored", expect.any(Number));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll session.active_list while the tab is hidden", async () => {
    // Visibility-gate regression: every open tab keeps a mounted <Chat>
    // (Layout hides inactive ones with display:none), so a hidden long-history
    // tab used to keep running this 2s poll — an active_list RPC plus a tail
    // reconcile per tick, per tab. That is the periodic main-thread stutter
    // that scaled with the number of long sessions left open. Mirrors the
    // foreign-turn test exactly (same runtime-session setup, same 7200ms
    // advance past interval + grace window) and changes ONLY active=false,
    // so a gate regression flips this from green to red.
    vi.useFakeTimers();
    try {
      dashboardMock.request.mockImplementation(async (method) => {
        if (method === "session.create") {
          return { session_id: "live", stored_session_id: "stored" };
        }
        if (method === "model.options") {
          return { model: "bad-model", provider: "bad-provider", providers: [] };
        }
        if (method === "session.active_list") {
          return { sessions: [{ id: "live", status: "working" }] };
        }
        return {};
      });
      const api: HarnessApi = {};
      render(<Harness active={false} api={api} initialConnectionMode="local" />);

      await act(async () => {
        await api.send?.("hello");
      });
      await act(async () => {
        dashboardMock.onEvent?.({
          type: "message.complete",
          payload: { content: "done" },
          session_id: "live",
        });
      });
      dashboardMock.request.mockClear();

      const getMessages = vi.fn(async () => []);
      (window.hermesAPI as unknown as { getSessionMessages: typeof getMessages }).getSessionMessages = getMessages;

      await act(async () => {
        // Same advance the visible-tab test uses to trigger the poll.
        vi.advanceTimersByTime(7200);
      });

      // LOAD-BEARING: the poller always RPCs active_list BEFORE any tail read,
      // so zero active_list calls means the 2s beat never ran while hidden.
      expect(dashboardMock.request).not.toHaveBeenCalledWith("session.active_list");
      // The one-shot post-complete sync (400ms, transport completeSyncTimer)
      // may fire at most once per turn end; a RECURRING read would exceed it.
      expect(getMessages.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests a fresh WebSocket URL immediately before connecting", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live", stored_session_id: "stored" };
      }
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} initialConnectionMode="remote" />);

    await act(async () => {
      await api.send?.("hello");
    });

    expect(window.hermesAPI.freshDashboardWsUrl).toHaveBeenCalledTimes(1);
    expect(dashboardMock.connect).toHaveBeenCalledWith("ws://fresh-dashboard");
  });

  it("surfaces OAuth login requirements without legacy fallback", async () => {
    // @lat: [[remote-dashboard-oauth#Test specifications#OAuth no-fallback]]
    const onUnavailable = vi.fn();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          running: false,
          needsOAuthLogin: true,
          error: "Sign in with your browser.",
          connection: { authMode: "oauth", wsUrl: "" },
        })),
      },
    });
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="remote"
        fallbackOnUnavailable
        onDashboardUnavailable={onUnavailable}
      />,
    );

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.send?.("hello");
    });

    expect(handled).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a clean runtime after a failed provider turn", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let liveModel = "bad-model";
    let liveProvider = "bad-provider";
    dashboardMock.request.mockImplementation(async (method, params) => {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-bad", stored_session_id: "stored-chat" };
      }
      if (method === "session.resume") {
        return { session_id: "live-recovery", resumed: "stored-chat" };
      }
      if (method === "slash.exec") {
        const command =
          params && typeof params === "object" && "command" in params
            ? String(params.command)
            : "";
        const match = command.match(/^\/model\s+(.+?)\s+--provider\s+(.+)$/);
        if (match) {
          liveModel = match[1];
          liveProvider = match[2];
        }
        return {};
      }
      if (method === "model.options") {
        return { model: liveModel, provider: liveProvider, providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);

    await act(async () => {
      await api.send?.("bad provider turn");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {
          error: "Invalid API Key",
          status: "error",
        },
        session_id: "live-bad",
        type: "message.complete",
      });
    });

    const badSend = api.send;
    await act(async () => {
      api.setProvider?.("good-provider");
      api.setModel?.("good-model");
      api.activeTurnRef!.current = { ...activeRecoveryTurn };
      api.setMessages?.((prev) => [
        ...prev,
        {
          id: "u-recovery",
          role: "user",
          content: "recovery turn",
          turnId: "turn-recovery",
        },
      ]);
    });
    await waitFor(() => expect(api.send).not.toBe(badSend));

    await act(async () => {
      await api.send?.("recovery turn");
    });

    // Recovery behavior since 657fbbb (no-new-sidebar-row fix): the poisoned
    // runtime is closed and the SAME stored session is resumed to a fresh
    // runtime id — recovery must NOT mint a second stored session row.
    expect(requests).toContainEqual({
      method: "session.resume",
      params: { session_id: "stored-chat", cols: 96 },
    });
    // Exactly ONE create (the initial session). Since the seeding/model commits
    // it legitimately carries seed messages + model/provider, so assert the
    // load-bearing shape instead of deep equality on params.
    expect(requests.filter((request) => request.method === "session.create"))
      .toEqual([
        expect.objectContaining({
          method: "session.create",
          params: expect.objectContaining({ cols: 96 }),
        }),
      ]);
    // The recovery turn submits on the FRESH runtime (live-recovery), never
    // on the failed one (live-bad) — the "clean runtime" part of this test.
    expect(requests).toContainEqual({
      method: "prompt.submit",
      params: { session_id: "live-recovery", text: "recovery turn" },
    });
    expect(requests).not.toContainEqual({
      method: "prompt.submit",
      params: { session_id: "live-bad", text: "recovery turn" },
    });
    expect(requests).not.toContainEqual({
      method: "session.create",
      params: {
        cols: 96,
        messages: [
          { role: "user", content: "bad provider turn" },
          { role: "assistant", content: "Error: Invalid API Key" },
        ],
      },
    });
    expect(window.hermesAPI.recordSessionLocalError).toHaveBeenCalledWith(
      "stored-chat",
      {
        error: "Invalid API Key",
        userContent: "bad provider turn",
      },
    );
    // Since 657fbbb recovery RESUMES the stored session (created=false), so
    // continuation re-seeding is intentionally skipped — the failure row is
    // already persisted via recordSessionLocalError above; re-feeding the
    // transcript would duplicate the turn in the reopened session.
    expect(window.hermesAPI.recordSessionContinuation).not.toHaveBeenCalled();
  });

  it("sends when model.options lags behind an accepted slash switch", async () => {
    // @lat: [[model-selection#Session model override#Non-blocking switch validation]]
    const requests: Array<{ method: string; params: unknown }> = [];
    dashboardMock.request.mockImplementation(async (method, params) => {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-stale", stored_session_id: "stored-stale" };
      }
      if (method === "session.resume") {
        return { session_id: "live-stale", resumed: "stored-stale" };
      }
      if (method === "slash.exec") {
        return { output: "✓ Model switched: good-model Provider: good-provider" };
      }
      if (method === "model.options") {
        return { model: "old-model", provider: "custom", providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);

    const initialSend = api.send;
    await act(async () => {
      api.setProvider?.("good-provider");
      api.setModel?.("good-model");
    });
    await waitFor(() => expect(api.send).not.toBe(initialSend));

    let handled: boolean | undefined;
    await act(async () => {
      handled = await api.send?.("hello");
    });

    expect(handled).toBe(true);
    expect(requests).toContainEqual({
      method: "slash.exec",
      params: {
        command: "/model good-model --provider good-provider",
        session_id: "live-stale",
      },
    });
    expect(requests.some((request) => request.method === "prompt.submit")).toBe(
      true,
    );
  });

  it("discards an in-flight dashboard client after the connection mode changes", async () => {
    let releaseFirstConnect: (() => void) | null = null;
    const requests: Array<{ method: string; params: unknown }> = [];

    dashboardMock.connect
      .mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            releaseFirstConnect = () => resolve(undefined);
          }),
      )
      .mockImplementation(async () => undefined);
    dashboardMock.request.mockImplementation(async (method, params) => {
      requests.push({ method, params });
      if (method === "session.create") {
        return { session_id: "live-new", stored_session_id: "stored-new" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi
          .fn()
          .mockResolvedValueOnce({
            connection: { wsUrl: "ws://old-dashboard" },
            running: true,
          })
          .mockResolvedValue({
            connection: { wsUrl: "ws://new-dashboard" },
            running: true,
          }),
      },
    });

    const api: HarnessApi = {};
    render(<Harness api={api} />);

    let firstSend: Promise<boolean> | null = null;
    await act(async () => {
      firstSend = api.send?.("first prompt") ?? null;
    });
    await waitFor(() =>
      expect(window.hermesAPI.startDashboard).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      api.setConnectionMode?.("remote");
    });

    await act(async () => {
      releaseFirstConnect?.();
      await firstSend;
    });

    expect(dashboardMock.close).toHaveBeenCalled();

    await act(async () => {
      api.activeTurnRef!.current = {
        startIndex: api.messages?.length ?? 0,
        status: "running",
        turnId: "turn-new",
        userId: "u-new",
      };
      api.setMessages?.((prev) => [
        ...prev,
        {
          id: "u-new",
          role: "user",
          content: "new prompt",
          turnId: "turn-new",
        },
      ]);
    });

    await act(async () => {
      await api.send?.("new prompt");
    });

    expect(dashboardMock.connect).toHaveBeenNthCalledWith(
      1,
      "ws://old-dashboard",
    );
    expect(dashboardMock.connect).toHaveBeenNthCalledWith(
      2,
      "ws://new-dashboard",
    );
    expect(requests.map((request) => request.method)).toContain(
      "prompt.submit",
    );
  });
});

describe("useDashboardChatTransport unavailable fallback (issue #667)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockStartDashboard(): ReturnType<typeof vi.fn> {
    const startDashboard = vi.fn(async () => ({
      running: false,
      error: "Hermes dashboard chat WebSocket is unavailable (404)",
    }));
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard,
      },
    });
    return startDashboard;
  }

  it("latches unavailable on SSH and fails fast on later sends, notifying once", async () => {
    const startDashboard = mockStartDashboard();
    const onUnavailable = vi.fn();
    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="ssh"
        fallbackOnUnavailable
        onDashboardUnavailable={onUnavailable}
      />,
    );

    let first: boolean | undefined;
    await act(async () => {
      first = await api.send?.("hello");
    });
    // Dashboard unavailable → caller falls back to legacy (returns false).
    expect(first).toBe(false);
    expect(startDashboard).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    let second: boolean | undefined;
    await act(async () => {
      second = await api.send?.("again");
    });
    expect(second).toBe(false);
    // Fast path: no second status/probe round-trip, no duplicate notice.
    expect(startDashboard).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("re-probes after the connection changes", async () => {
    const startDashboard = mockStartDashboard();
    const api: HarnessApi = {};
    render(
      <Harness api={api} initialConnectionMode="ssh" fallbackOnUnavailable />,
    );

    await act(async () => {
      await api.send?.("hello");
    });
    expect(startDashboard).toHaveBeenCalledTimes(1);

    // Switching connection clears the sticky flag → the dashboard is retried.
    await act(async () => {
      api.setConnectionMode?.("remote");
    });
    await act(async () => {
      await api.send?.("after change");
    });
    expect(startDashboard).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying on local (does not latch)", async () => {
    const startDashboard = mockStartDashboard();
    const api: HarnessApi = {};
    render(
      <Harness api={api} initialConnectionMode="local" fallbackOnUnavailable />,
    );

    await act(async () => {
      await api.send?.("hello");
    });
    await act(async () => {
      await api.send?.("again");
    });
    // Local dashboard may still be spawning, so each send re-checks.
    expect(startDashboard).toHaveBeenCalledTimes(2);
  });
});

describe("useDashboardChatTransport messagesRef sync", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
        getSessionMessages: vi.fn(async () => []),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // `background.complete` appends an agent bubble built from `messagesRef.current`,
  // so it reads exactly the array the sync effect maintains — a clean probe for
  // whether the ref adopted an external Chat-state change. It requires a live
  // gateway client, so every test connects with one `send` first (which does not
  // append a user bubble — Chat owns that).
  const connect = async (api: HarnessApi): Promise<void> => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    await act(async () => {
      await api.send?.("hello");
    });
    expect(dashboardMock.onEvent).toBeTypeOf("function");
  };

  const backgroundComplete = async (): Promise<void> => {
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { task_id: "t1", text: "bg answer" },
        type: "background.complete",
      });
    });
  };

  it("adopts an external clear so a new turn does not resurrect deleted messages (#757)", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);

    // Chat's `handleClear` empties the list without unmounting <Chat>. A length
    // guard (`messages.length > ref.length`) would skip this and leave the ref
    // pointing at the deleted turn, so the next event would append onto it.
    await act(async () => {
      api.setMessages?.([]);
    });
    await backgroundComplete();

    expect(api.messages).toHaveLength(1);
    expect(api.messages?.[0]?.id).toBe("bg-t1");
  });

  it("adopts a same-length in-place replacement (clarify resolve / edit)", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);

    // Same length, different content — mirrors `handleClarifyResolved` mapping a
    // clarify card to resolved before the gateway resumes the turn.
    await act(async () => {
      api.setMessages?.([
        { id: "u-edited", role: "user", content: "edited turn" },
      ]);
    });
    await backgroundComplete();

    expect(api.messages).toHaveLength(2);
    expect(api.messages?.[0]?.id).toBe("u-edited");
    expect(api.messages?.[1]?.id).toBe("bg-t1");
  });
});

describe("useDashboardChatTransport context gauge estimate (no usage payload)", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
        getSessionMessages: vi.fn(async () => []),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Resolve the final usage object a setUsage((prev) => next) call produces.
  const lastUsage = (setUsage: SetUsageMock): UsageState | null => {
    expect(setUsage).toHaveBeenCalled();
    const updater = setUsage.mock.calls.at(-1)?.[0];
    if (typeof updater !== "function") {
      throw new Error("setUsage was not called with an updater function");
    }
    return updater(null);
  };

  it("sets an estimated contextTokens when a successful completion has no usage", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    // Provider omitted usage entirely → usageFromPayload returns null. The
    // gauge only renders when contextTokens is set, so the estimate must fill
    // it in — this was the case the gauge went blank on (#789).
    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { status: "completed", final_response: "hi there" },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    const usage = lastUsage(setUsage);
    expect(usage?.contextTokens).toBeGreaterThan(0);
  });

  it("prefers exact payload usage over the estimate", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: {
          status: "completed",
          final_response: "hi there",
          usage: { input: 5000, output: 200, context_used: 45000 },
        },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    const usage = lastUsage(setUsage);
    expect(usage?.contextTokens).toBe(45000);
  });

  it("does not fabricate usage for a failed turn without usage", async () => {
    const setUsage = vi.fn() as SetUsageMock;
    const api: HarnessApi = {};
    render(<Harness api={api} setUsage={setUsage} />);
    await act(async () => {
      await api.send?.("hello");
    });

    await act(async () => {
      dashboardMock.onEvent?.({
        payload: { status: "error", error: "Invalid API Key" },
        session_id: "live-1",
        type: "message.complete",
      });
    });

    expect(setUsage).not.toHaveBeenCalled();
  });
});

describe("useDashboardChatTransport plan mode", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
        getSessionMessages: vi.fn(async () => []),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const connect = async (api: HarnessApi): Promise<void> => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    await act(async () => {
      await api.send?.("hello");
    });
    expect(dashboardMock.onEvent).toBeTypeOf("function");
  };

  const toolStart = (): void => {
    dashboardMock.onEvent?.({
      payload: {
        context: "Writing a file",
        name: "write_file",
        tool_id: "t-plan",
      },
      session_id: "live-1",
      type: "tool.start",
    });
  };

  const blockedCount = (api: HarnessApi): number =>
    JSON.stringify(api.messages).split("BLOCKED: Plan mode is active").length - 1;

  it("blocks write-tool starts while plan mode is on", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} initialPlanMode={true} />);
    await connect(api);

    await act(() => toolStart());

    expect(blockedCount(api)).toBe(1);
  });

  it("does not block write-tool starts when plan mode is off", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} initialPlanMode={false} />);
    await connect(api);

    await act(() => toolStart());

    expect(blockedCount(api)).toBe(0);
  });

  it("stops blocking write tools after the user toggles plan mode off", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} initialPlanMode={true} />);
    await connect(api);

    await act(() => toolStart());
    expect(blockedCount(api)).toBe(1);

    await act(async () => {
      api.setPlanMode?.(false);
    });
    await act(() => toolStart());

    // The second tool.start passes through untouched — no new BLOCKED row.
    expect(blockedCount(api)).toBe(1);
  });
});

describe("useDashboardChatTransport approval prompts", () => {
  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        freshDashboardWsUrl: vi.fn(async () => "ws://fresh-dashboard"),
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
        getSessionMessages: vi.fn(async () => []),
        promptApproval: vi.fn(async () => "once"),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const connect = async (api: HarnessApi): Promise<void> => {
    dashboardMock.request.mockImplementation(async (method: string) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      return {};
    });
    await act(async () => {
      await api.send?.("hello");
    });
    expect(dashboardMock.onEvent).toBeTypeOf("function");
  };

  const emitApproval = async (
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await act(async () => {
      dashboardMock.onEvent?.({ payload, type: "approval.request" });
    });
  };

  // The gateway parks the agent thread on approval.request until it is
  // answered, so an ignored event is what made the command look like it hung.
  it("answers approval.request with the user's choice", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    dashboardMock.request.mockImplementation(
      async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { resolved: 1 };
      },
    );

    await emitApproval({
      choices: ["once", "session", "deny"],
      command: "rm -rf /tmp/x",
      description: "recursive delete",
      request_id: "req-1",
    });

    await waitFor(() => {
      expect(calls.some((call) => call.method === "approval.respond")).toBe(
        true,
      );
    });

    const respond = calls.find((call) => call.method === "approval.respond");
    expect(respond?.params).toMatchObject({
      all: false,
      choice: "once",
      request_id: "req-1",
    });

    // The native dialog is asked for exactly what the backend offered,
    // including the command being judged.
    expect(window.hermesAPI.promptApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: ["once", "session", "deny"],
        command: "rm -rf /tmp/x",
        description: "recursive delete",
      }),
    );
  });

  it("sends the denied choice back when the user rejects", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);
    (
      window.hermesAPI.promptApproval as ReturnType<typeof vi.fn>
    ).mockResolvedValue("deny");

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    dashboardMock.request.mockImplementation(
      async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { resolved: 1 };
      },
    );

    await emitApproval({ choices: ["once", "deny"], request_id: "req-2" });

    await waitFor(() => {
      expect(calls.some((call) => call.method === "approval.respond")).toBe(
        true,
      );
    });
    expect(
      calls.find((call) => call.method === "approval.respond")?.params,
    ).toMatchObject({ choice: "deny", request_id: "req-2" });
  });

  // An unanswered approval must never be read as consent: without a bridge
  // the transport still has to answer, and the safe answer is deny.
  it("fails closed to deny when the prompt bridge is missing", async () => {
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await connect(api);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        freshDashboardWsUrl: vi.fn(async () => "ws://fresh-dashboard"),
        getSessionMessages: vi.fn(async () => []),
        recordSessionContinuation: vi.fn(async () => true),
        recordSessionLocalError: vi.fn(async () => true),
        startDashboard: vi.fn(async () => ({
          connection: { wsUrl: "ws://127.0.0.1:12345" },
          running: true,
        })),
      },
    });

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    dashboardMock.request.mockImplementation(
      async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { resolved: 1 };
      },
    );

    await emitApproval({ choices: ["once", "deny"], request_id: "req-3" });

    await waitFor(() => {
      expect(calls.some((call) => call.method === "approval.respond")).toBe(
        true,
      );
    });
    expect(
      calls.find((call) => call.method === "approval.respond")?.params,
    ).toMatchObject({ choice: "deny" });
  });
});

describe("subagent watch lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it.each([false, true])("keeps child work busy until completion (resume running=%s)", async (running) => {
    vi.useFakeTimers();
    dashboardMock.request.mockReset();
    dashboardMock.connect.mockResolvedValue(undefined);
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.resume") {
        return { session_id: "live-child", resumed: "stored-child", running, status: running ? "streaming" : "idle" };
      }
      if (method === "session.active_list") {
        return { sessions: [{ id: "live-child", status: "idle" }] };
      }
      return {};
    });
    const setIsLoading = vi.fn();
    const activeTurnRef: MutableRefObject<ActiveTurn | null> = { current: null };
    const rows = [
      { id: 1, role: "user", content: "child task" },
      { id: 2, role: "assistant", content: "Checking the files." },
    ];
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        startDashboard: vi.fn(async () => ({ running: true, connection: { wsUrl: "ws://test" } })),
        getSessionMessages: vi.fn(async () => rows),
      },
    });
    function WatchHarness(): null {
      const [messages, setMessages] = useState<ChatMessage[]>([
        { id: "db-1", role: "user", content: "child task" },
      ]);
      useDashboardChatTransport({
        activeTurnRef, contextFolder: null, connectionMode: "local", enabled: true,
        fallbackOnUnavailable: false, hermesSessionId: "stored-child", watchChild: true,
        messages, setMessages, setIsLoading, setHermesSessionId: vi.fn(),
        setToolProgress: vi.fn(), setUsage: vi.fn(),
      });
      return null;
    }
    const view = render(<WatchHarness />);
    await act(async () => {});
    if (running) {
      expect(setIsLoading).toHaveBeenLastCalledWith(true);
      expect(activeTurnRef.current?.status).toBe("running");
    } else {
      await act(async () => {
        dashboardMock.onEvent?.({ type: "message.start", session_id: "other-child" });
        dashboardMock.onEvent?.({ type: "sessions.changed" });
      });
      expect(setIsLoading).not.toHaveBeenCalled();
      expect(activeTurnRef.current).toBeNull();
    }
    await act(async () => {
      dashboardMock.onEvent?.({ type: "message.start", session_id: "live-child" });
      dashboardMock.onEvent?.({ type: "tool.start", session_id: "live-child", payload: { name: "read_file", tool_id: "t1" } });
      dashboardMock.onEvent?.({ type: "tool.complete", session_id: "live-child", payload: { name: "read_file", tool_id: "t1", result: "file" } });
    });
    expect(setIsLoading).toHaveBeenLastCalledWith(true);
    expect(activeTurnRef.current?.status).toBe("running");
    await act(async () => { await vi.advanceTimersByTimeAsync(130_000); });
    expect(setIsLoading).toHaveBeenLastCalledWith(true);
    expect(activeTurnRef.current?.status).toBe("running");
    await act(async () => {
      dashboardMock.onEvent?.({ type: "message.complete", session_id: "live-child", payload: { text: "done" } });
    });
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
    expect(activeTurnRef.current).toBeNull();
    view.unmount();
  });
});

describe("ensureDashboardRuntimeSession — subagent watch attach", () => {
  const makeClient = () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    // Typed generically to match DashboardPromptClient.request<T>, which the
    // helper accepts.
    const client = {
      request: <T,>(method: string, params: unknown = {}): Promise<T> => {
        calls.push({
          method,
          params: (params ?? {}) as Record<string, unknown>,
        });
        if (method === "session.resume") {
          // The gateway's lazy-resume reply: a live (runtime) session id plus
          // the stored id it attached to, and the child liveness flags.
          return Promise.resolve({
            session_id: "live-watch",
            resumed: "stored-child",
            running: true,
            status: "streaming",
          } as unknown as T);
        }
        return Promise.resolve({} as unknown as T);
      },
    };
    return { calls, client };
  };

  const resumeCall = (calls: Array<{ method: string; params: unknown }>) =>
    calls.find((call) => call.method === "session.resume");

  // A delegated child runs inside its parent's turn, so its window must attach
  // WITHOUT building an agent -- otherwise the gateway's child-mirror refuses to
  // stream the child's live events into it and the window looks finished.
  it("sends lazy:true for a watch window", async () => {
    const { calls, client } = makeClient();

    const result = await ensureDashboardRuntimeSession({
      client,
      lazy: true,
      messages: [],
      storedSessionId: "stored-child",
    });

    expect(resumeCall(calls)?.params).toMatchObject({
      session_id: "stored-child",
      lazy: true,
    });
    // Attached, not created: the stored session must not be duplicated.
    expect(result.created).toBe(false);
    expect(result.runtimeSessionId).toBe("live-watch");
    expect(result.storedSessionId).toBe("stored-child");
    // The busy indicator for a watch window is seeded from this flag.
    expect(result.running).toBe(true);
  });

  it("omits lazy for an ordinary eager resume", async () => {
    const { calls, client } = makeClient();

    await ensureDashboardRuntimeSession({
      client,
      messages: [],
      storedSessionId: "stored-child",
    });

    const params = resumeCall(calls)?.params as Record<string, unknown>;
    expect(params.session_id).toBe("stored-child");
    expect(params).not.toHaveProperty("lazy");
  });
});
