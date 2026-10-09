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
  isModelSwitchConfirmation,
  modelSwitchReportedSuccess,
  submitDashboardPromptWithRecovery,
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
  abort?: () => void;
  setConnectionMode?: Dispatch<SetStateAction<"local" | "remote" | "ssh">>;
  setMessages?: Dispatch<SetStateAction<ChatMessage[]>>;
  setModel?: Dispatch<SetStateAction<string>>;
  setPlanMode?: Dispatch<SetStateAction<boolean>>;
  setProvider?: Dispatch<SetStateAction<string>>;
  /** Flip the attached knowledge bundles mid-session. */
  setKnowledgeBundles?: Dispatch<SetStateAction<string[]>>;
  /** Summaries reported through `onKnowledgeChanged`. */
  knowledgeNotices?: string[];
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
  initialKnowledgeBundles = [],
  fallbackOnUnavailable = false,
  initialConnectionMode = "local",
  initialPlanMode = false,
  modelBaseUrl,
  profile,
  onDashboardUnavailable,
  setUsage = vi.fn() as SetUsageMock,
}: {
  active?: boolean;
  api: HarnessApi;
  initialKnowledgeBundles?: string[];
  fallbackOnUnavailable?: boolean;
  initialConnectionMode?: "local" | "remote" | "ssh";
  initialPlanMode?: boolean;
  modelBaseUrl?: string;
  profile?: string;
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
  const [knowledgeBundles, setKnowledgeBundles] = useState<string[]>(
    initialKnowledgeBundles,
  );
  const knowledgeNotices = useRef<string[]>([]);
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
    knowledgeBundles,
    onKnowledgeChanged: (summary) => knowledgeNotices.current.push(summary),
    messages,
    model,
    planMode,
    profile,
    modelBaseUrl,
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
      abort: transport.abort,
      setConnectionMode,
      setMessages,
      setModel,
      setPlanMode,
      setProvider,
      setKnowledgeBundles,
      knowledgeNotices: knowledgeNotices.current,
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
        getKnowledgeIndex: vi.fn(async () => "KNOWLEDGE-INDEX"),
      },
    });
  });

  it("records private stage timings and only the first accepted nonempty delta", async () => {
    window.__HERMES_SEND_TIMINGS__ = [];
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") return { session_id: "live", stored_session_id: "stored" };
      if (method === "model.options") return { model: "bad-model", provider: "bad-provider" };
      return {};
    });
    const api: HarnessApi = {};
    render(<Harness api={api} />);
    await act(async () => { await api.send?.("private prompt"); });
    const stages = () => window.__HERMES_SEND_TIMINGS__?.map((row) => row.stage);
    expect(stages()).toEqual(["send-start", "client-ready", "session-ready", "model-ready", "submit", "submit-ack"]);
    await act(async () => {
      dashboardMock.onEvent?.({ type: "message.delta", session_id: "foreign", payload: { text: "secret" } });
      dashboardMock.onEvent?.({ type: "message.delta", session_id: "live", payload: { text: "" } });
    });
    expect(stages()).not.toContain("first-delta");
    await act(async () => {
      dashboardMock.onEvent?.({ type: "reasoning.delta", session_id: "live", payload: { text: "secret reasoning" } });
      dashboardMock.onEvent?.({ type: "message.delta", session_id: "live", payload: { text: "secret answer" } });
    });
    expect(stages()?.filter((stage) => stage === "first-delta")).toHaveLength(1);
    for (const row of window.__HERMES_SEND_TIMINGS__ ?? []) {
      expect(Object.keys(row).sort()).toEqual(["elapsedMs", "send", "stage"]);
      expect(row.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(window.__HERMES_SEND_TIMINGS__)).not.toMatch(/private|secret|live|stored/);
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

  it.each([false, true])("closed-pipe selection retry respects interrupt=%s", async (interrupt) => {
    let rejectSwitch!: (error: Error) => void;
    let calls = 0;
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create" || method === "session.resume") return { session_id: "live", stored_session_id: "stored" };
      if (method === "session.status") return { output: "Model: old (bad-provider)" };
      if (method === "model.options") return { model: "old", provider: "bad-provider" };
      if (method === "slash.exec") {
        if (++calls === 1) return new Promise((_resolve, reject) => { rejectSwitch = reject; });
        return { output: "Model switched" };
      }
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    try {
      let sent!: Promise<boolean>;
      await act(async () => { sent = api.send!("hello"); });
      await waitFor(() => expect(rejectSwitch).toBeTypeOf("function"));
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "prompt.submit")).toHaveLength(0);
      if (interrupt) act(() => api.abort!());
      await act(async () => { rejectSwitch(new Error("slash worker closed pipe")); await sent; });
      expect(calls).toBe(interrupt ? 1 : 2);
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "prompt.submit")).toHaveLength(interrupt ? 0 : 1);
    } finally { view.unmount(); }
  });

  it("waits for model switch before first submit and clears its failure on manual retry", async () => {
    let liveModel = "old-model";
    let rejectSwitch!: (error: Error) => void;
    let switching = true;
    let selectionAttempts = 0;
    dashboardMock.request.mockImplementation(async (method, params) => {
      if (method === "session.create" || method === "session.resume")
        return { session_id: "live", stored_session_id: "stored" };
      if (method === "session.status")
        return { output: `Hermes TUI Status\nModel: ${liveModel} (bad-provider)\nTokens: 0` };
      if (method === "model.options")
        return { model: liveModel, provider: "bad-provider", providers: [] };
      if (method === "slash.exec") {
        if (switching) {
          // The transport replays ONLY this idempotent selection, so the first
          // attempt awaits and is rejected by the test; the retry (attempt 2)
          // is what must succeed. A third attempt would mean it looped.
          selectionAttempts += 1;
          if (selectionAttempts > 1) throw new Error("slash worker closed pipe");
          return new Promise((_resolve, reject) => { rejectSwitch = reject; });
        }
        liveModel = String(params.command).split(" ")[1];
        return { output: "Model switched" };
      }
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    try {
      await act(async () => { api.setMessages?.([]); api.setModel?.("selected-model"); });
      let first!: Promise<boolean>;
      await act(async () => { first = api.send!("hello"); });
      await waitFor(() => expect(rejectSwitch).toBeTypeOf("function"));
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "prompt.submit")).toHaveLength(0);
      await act(async () => { rejectSwitch(new Error("slash worker closed pipe")); await first; });
      expect(api.messages?.some((m) => "error" in m && m.error === "slash worker closed pipe")).toBe(true);
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "slash.exec")).toHaveLength(2);
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "prompt.submit")).toHaveLength(0);
      switching = false;
      await act(async () => { await api.send?.("hello"); });
      expect(api.messages?.some((m) => "error" in m && m.error === "slash worker closed pipe")).toBe(false);
      expect(dashboardMock.request.mock.calls.filter(([m]) => m === "prompt.submit")).toHaveLength(1);
      await act(async () => {
        dashboardMock.onEvent?.({ type: "message.complete", session_id: "live", payload: { status: "success" } });
      });
      expect(api.messages?.some((m) => "error" in m && m.error === "slash worker closed pipe")).toBe(false);
    } finally { view.unmount(); }
  });

  it("uses live status without catalog or resets after slow repeated sends", async () => {
    let now = 100_000;
    let liveModel = "bad-model";
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    dashboardMock.request.mockImplementation(async (method, params) => {
      if (method === "session.create") return { session_id: "live", stored_session_id: "stored" };
      if (method === "session.status") return { output: `Hermes TUI Status\nModel: ${liveModel} (bad-provider)\nTokens: 0` };
      if (method === "model.options") { now += 5_900; return { model: liveModel, provider: "bad-provider", providers: [] }; }
      if (method === "slash.exec") liveModel = String(params.command).split(" ")[1];
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    try {
      await act(async () => { await api.send?.("first"); });
      now += 33_000;
      await act(async () => { await api.send?.("second"); });
      expect(dashboardMock.request.mock.calls.map(([method]) => method)).toEqual([
        "session.create", "session.status", "prompt.submit", "session.status", "prompt.submit",
      ]);
      liveModel = "foreign-model";
      await act(async () => { await api.send?.("restore selection"); });
      expect(liveModel).toBe("bad-model");
      expect(dashboardMock.request.mock.calls.some(([method]) => method === "session.close")).toBe(false);
      expect(dashboardMock.request.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(3);
    } finally { view.unmount(); clock.mockRestore(); }
  });

  it("reuses validated model options across sends (no re-probe per message)", async () => {
    let now = 100_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create" || method === "session.resume")
        return { session_id: "live", stored_session_id: "stored" };
      if (method === "model.options")
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    const optionsCount = () => dashboardMock.request.mock.calls.filter(([method]) => method === "model.options").length;
    try {
      await act(async () => { await api.send?.("first"); });
      const initial = optionsCount();
      // One probe to learn the live inventory (the switch is then attempted).
      expect(initial).toBeGreaterThanOrEqual(1);
      // A later send with the same selection must NOT re-probe the provider
      // catalog. This was the per-message delay: an uncached `model.options`
      // re-probes the custom provider's /v1/models (2.7-4.6 s measured).
      now += 60_000;
      await act(async () => { await api.send?.("repeat"); });
      expect(optionsCount()).toBe(initial);
      now += 60_000;
      await act(async () => { await api.send?.("repeat-again"); });
      expect(optionsCount()).toBe(initial);
    } finally {
      view.unmount();
      clock.mockRestore();
    }
  });

  it.each(["model", "provider", "baseUrl", "profile", "reconnect", "failure", "foreign", "broadcast"])("invalidates model inventory on %s", async (reason) => {
    let now = 100_000;
    let liveModel = "bad-model";
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    dashboardMock.request.mockImplementation(async (method, params) => {
      if (method === "session.create" || method === "session.resume")
        return { session_id: "live", stored_session_id: "stored" };
      // Report the live identity so a FOREIGN model change is observable. Without
      // this the fixture returned `{}`, leaving `identity` null — so the old
      // `if (identity) cache = null` line could never fire and the "foreign"
      // case was really only passing because the 2s TTL expired.
      if (method === "session.status")
        return { output: `Model: ${liveModel} (bad-provider)\nTokens: 0` };
      if (method === "model.options")
        return { model: liveModel, provider: "bad-provider", providers: [] };
      if (method === "slash.exec") liveModel = String(params.command).split(" ")[1];
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    try {
      await act(async () => { await api.send?.("first"); });
      const first = dashboardMock.request.mock.calls.length;
      await act(async () => {
        if (reason === "model") api.setModel?.("new-model");
        if (reason === "provider") api.setProvider?.("new-provider");
        if (reason === "baseUrl") view.rerender(<Harness api={api} modelBaseUrl="https://other.invalid" />);
        if (reason === "profile") view.rerender(<Harness api={api} profile="other" />);
        if (reason === "reconnect") dashboardMock.instances[0].connected = false;
        if (reason === "failure") dashboardMock.onEvent?.({ type: "message.complete", session_id: "live", payload: { status: "error", error: "test" } });
        if (reason === "broadcast") dashboardMock.onEvent?.({ type: "sessions.changed", payload: {} });
        if (reason === "foreign") { liveModel = "foreign-model"; now += 2_001; }
        // The invalidation paths exist to protect against the session's live
        // model having moved underneath us (the DB is shared, so ANY process can
        // switch it). Model that directly: after the invalidation the live
        // session is on a different model than the one we selected, so the send
        // path must re-read the inventory rather than trusting a fast return.
        if (!["model", "foreign"].includes(reason)) liveModel = "moved-model";
      });
      await act(async () => { await api.send?.("next"); });
      const calls = dashboardMock.request.mock.calls.slice(first);
      expect(calls.some(([method]) => method === "model.options")).toBe(true);
      // The fixture never applies a provider switch: fail closed, not on the old provider.
      expect(calls.some(([method]) => method === "prompt.submit")).toBe(reason !== "provider");
      if (reason === "model" || reason === "foreign") {
        const switchIndex = calls.findIndex(([method]) => method === "slash.exec");
        expect(switchIndex).toBeGreaterThanOrEqual(0);
        // Verification prefers `session.status` (immediate) over the lagging
        // `model.options` catalog read.
        expect(calls[switchIndex + 1][0]).toBe("session.status");
        expect(liveModel).toBe(reason === "model" ? "new-model" : "bad-model");
      }
    } finally { view.unmount(); clock.mockRestore(); }
  });

  it("auto-accepts a large-context switch confirmation so the turn is never parked", async () => {
    let liveModel = "bad-model";
    let liveProvider = "bad-provider";
    const slashCommands: string[] = [];
    let submitted = false;
    dashboardMock.request.mockImplementation(async (method, params) => {
      if (method === "session.create" || method === "session.resume")
        return { session_id: "live", stored_session_id: "stored" };
      if (method === "session.status")
        return { output: `Model: ${liveModel} (${liveProvider})\nTokens: 0` };
      if (method === "model.options")
        return { model: liveModel, provider: liveProvider, providers: [] };
      if (method === "slash.exec") {
        const command =
          params && typeof params === "object" && "command" in params
            ? String(params.command)
            : "";
        slashCommands.push(command);
        const match = command.match(/^\/model\s+(.+?)\s+--provider\s+(.+)$/);
        if (match) {
          // The guard ask applies NOTHING; the gateway confirm reply (/approve)
          // is what actually lands the switch.
          return {
            warning:
              "!!! LARGE CONTEXT MODEL SWITCH !!!\n\nThis session holds ~144,295 tokens of context.\n" +
              "Threshold: model.switch_context_confirm_tokens (currently 100,000; 0 disables this check).\n" +
              "Confirm only if you intend to switch now.",
            output: "",
          };
        }
        if (command === "/approve") {
          liveModel = "cbai/deepseek-v4.1-flash";
          return { output: "Model switched", warning: "" };
        }
        return {};
      }
      if (method === "prompt.submit") submitted = true;
      return {};
    });
    const api: HarnessApi = {};
    const view = render(<Harness api={api} />);
    try {
      await act(async () => {
        api.setModel?.("cbai/deepseek-v4.1-flash");
      });
      await act(async () => { await api.send?.("hello"); });
      // The confirm is auto-answered: the switch lands and the turn is sent,
      // rather than parking on a prompt the desktop cannot render.
      expect(submitted).toBe(true);
      expect(liveModel).toBe("cbai/deepseek-v4.1-flash");
      expect(slashCommands).toContain("/approve");
    } finally { view.unmount(); }
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

  it("blocks submission when an accepted slash switch cannot be validated", async () => {
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
        // A GENUINE failure: no success line, so there is nothing to trust.
        return { output: "Unknown provider 'good-provider'" };
      }
      if (method === "session.status") {
        return { output: "Model: old-model (old-provider)\nTokens: 0" };
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
      false,
    );
  });

  it("does NOT block a switch the gateway already confirmed", async () => {
    // THE reported bug: /model returned "✓ Model switched", the switch HAD
    // applied, but verification read a lagging identity and threw "did not
    // switch" — blocking a send the user had explicitly asked for. A confirmed
    // success must let the turn through.
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
        // Confirmed success — even though every identity probe below still
        // reports the OLD model (the lag that caused the false failure).
        return { output: "✓ Model switched: good-model\n    Provider: good-provider" };
      }
      if (method === "session.status") {
        return { output: "Model: old-model (old-provider)\nTokens: 0" };
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

    await act(async () => {
      await api.send?.("hello");
    });

    // The prompt goes through despite the stale identity reads.
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

describe("submitDashboardPromptWithRecovery — prompt.submit payload contract", () => {
  // REGRESSION: the renderer used to send `raw_system_prompt` on EVERY
  // prompt.submit. Newer Hermes backends reject unknown params
  // ("invalid params for prompt.submit: raw_system_prompt: Extra inputs are not
  // permitted"), which broke every send — not just when the fork's SYS/RAW
  // toggle was on. The toggle was removed; this pins the wire shape so a stray
  // extra field cannot silently break sending again.
  type Call = { method: string; params: Record<string, unknown> };

  const makeClient = (
    onCall?: (call: Call) => void,
    opts: { resume?: unknown } = {},
  ) => {
    const calls: Call[] = [];
    const client = {
      request: <T,>(method: string, params: unknown = {}): Promise<T> => {
        const call = { method, params: (params ?? {}) as Record<string, unknown> };
        calls.push(call);
        onCall?.(call);
        if (method === "session.resume") {
          return Promise.resolve(
            (opts.resume ?? {
              session_id: "live-recovered",
              resumed: "stored-1",
            }) as unknown as T,
          );
        }
        return Promise.resolve({} as unknown as T);
      },
    };
    return { calls, client };
  };

  it("sends ONLY session_id, text and profile — no raw_system_prompt", async () => {
    const { calls, client } = makeClient();
    await submitDashboardPromptWithRecovery(client, {
      sessionId: "live-1",
      storedSessionId: "stored-1",
      text: "hello",
    });

    const submit = calls.find((c) => c.method === "prompt.submit");
    expect(submit).toBeDefined();
    expect(submit?.params).toEqual({
      session_id: "live-1",
      text: "hello",
    });
    // The exact failure that prompted this test.
    expect(submit?.params).not.toHaveProperty("raw_system_prompt");
  });

  it("omits profile for the default profile but sends it otherwise", async () => {
    const a = makeClient();
    await submitDashboardPromptWithRecovery(a.client, {
      sessionId: "live-1",
      text: "hi",
      profile: "default",
    });
    expect(a.calls.find((c) => c.method === "prompt.submit")?.params).toEqual({
      session_id: "live-1",
      text: "hi",
    });

    const b = makeClient();
    await submitDashboardPromptWithRecovery(b.client, {
      sessionId: "live-1",
      text: "hi",
      profile: "work",
    });
    expect(b.calls.find((c) => c.method === "prompt.submit")?.params).toEqual({
      session_id: "live-1",
      text: "hi",
      profile: "work",
    });
  });

  it("keeps the payload clean on the session-not-found recovery retry too", async () => {
    // First submit throws session-not-found; the helper resumes then retries.
    // BOTH submits must be clean — the retry previously carried the param too.
    let submitCount = 0;
    const { calls, client } = makeClient(undefined, {
      resume: { session_id: "live-recovered", resumed: "stored-1" },
    });
    const origRequest = client.request;
    client.request = <T,>(method: string, params: unknown = {}) => {
      if (method === "prompt.submit") {
        submitCount += 1;
        if (submitCount === 1) {
          calls.push({ method, params: (params ?? {}) as Record<string, unknown> });
          return Promise.reject(new Error("session not found")) as Promise<T>;
        }
      }
      return origRequest<T>(method, params);
    };

    await submitDashboardPromptWithRecovery(client, {
      sessionId: "live-dead",
      storedSessionId: "stored-1",
      text: "retry me",
    });

    const submits = calls.filter((c) => c.method === "prompt.submit");
    expect(submits.length).toBe(2);
    for (const submit of submits) {
      expect(submit.params).not.toHaveProperty("raw_system_prompt");
      for (const key of Object.keys(submit.params)) {
        // The wire protocol is snake_case; a camelCase key is a renderer leak.
        expect(key).toBe(key.toLowerCase());
      }
    }
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
        active: true, activeTurnRef, contextFolder: null, connectionMode: "local", enabled: true,
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

// A lost `message.complete` used to leave the turn spinning until the tab was
// reopened. Two things kept the recovery clock alive: a dropped event (runtime
// id rotated out from under an in-flight turn) must still re-arm instead of
// silently stopping, and the read must not retry forever on repeated failures.
describe("recovery liveness", () => {
  it("keeps re-arming when an event is dropped for a stale runtime id", async () => {
    const activeTurnRef = {
      current: null as { turnId: string; userId: string; startIndex: number; status: string } | null,
    };
    const setIsLoading = vi.fn();
    function Harness(): null {
      const [messages, setMessages] = useState<ChatMessage[]>([
        { id: "db-1", role: "user", content: "do it" },
      ]);
      useDashboardChatTransport({
        active: true, activeTurnRef: activeTurnRef as never, contextFolder: null,
        connectionMode: "local", enabled: true, fallbackOnUnavailable: false,
        hermesSessionId: "stored-1", messages, setMessages, setIsLoading,
        setHermesSessionId: vi.fn(), setToolProgress: vi.fn(), setUsage: vi.fn(),
      });
      return null;
    }
    const view = render(<Harness />);
    await act(async () => {
      dashboardMock.onEvent?.({ type: "message.start", session_id: "live-1" });
    });
    const turnBefore = activeTurnRef.current;
    // An event for an unrelated session id is dropped, but must not settle or
    // clear the live turn — only the DB read may do that.
    await act(async () => {
      dashboardMock.onEvent?.({ type: "message.delta", session_id: "stale-other", payload: { text: "x" } });
    });
    expect(activeTurnRef.current).toBe(turnBefore);
    expect(setIsLoading).not.toHaveBeenLastCalledWith(false);
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

describe("mid-session knowledge toggle", () => {
  beforeEach(() => {
    // Self-contained API mock: this describe must not depend on another
    // block's beforeEach having run.
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
        getKnowledgeIndex: vi.fn(async () => "KNOWLEDGE-INDEX"),
      },
    });
  });

  beforeEach(() => {
    dashboardMock.close.mockClear();
    dashboardMock.connect.mockClear();
    dashboardMock.instances.length = 0;
    dashboardMock.onEvent = null;
    dashboardMock.request.mockReset();
  });

  it("rebuilds the runtime session on the next prompt instead of minting a new one", async () => {
    // The index is seeded ONCE via session.create. A mid-session toggle must
    // mark the runtime stale so the next prompt re-seeds it — while resuming the
    // SAME stored session (a new session.create would add a sidebar row).
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      if (method === "session.resume") {
        return { session_id: "live-2", resumed: "stored-1" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="local"
        initialKnowledgeBundles={["alpha"]}
      />,
    );

    // First prompt seeds the runtime with the alpha bundle.
    await act(async () => {
      await api.send?.("first");
    });
    const createsAfterFirst = dashboardMock.request.mock.calls.filter(
      (c) => c[0] === "session.create",
    ).length;
    expect(createsAfterFirst).toBe(1);

    // End the turn so the user is back at the composer (the realistic moment
    // to toggle a bundle).
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        payload: { content: "ok" },
        session_id: "live-1",
      });
    });

    // Toggle a bundle on mid-session. Before the fix this was a silent no-op.
    await act(async () => {
      api.setKnowledgeBundles?.(["alpha", "beta"]);
    });

    // The NEXT prompt must rebuild the runtime: the old runtime is closed and

    // the SAME stored session is resumed (never a second create).
    await act(async () => {
      await api.send?.("second");
    });
    const methods = dashboardMock.request.mock.calls.map((c) => c[0]);
    expect(methods).toContain("session.close");
    expect(methods).toContain("session.resume");
    expect(
      methods.filter((m) => m === "session.create").length,
      "recovery must not mint a second session row",
    ).toBe(1);
  });

  it("reports the change so the UI can explain the timing", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      if (method === "session.resume") {
        return { session_id: "live-2", resumed: "stored-1" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="local"
        initialKnowledgeBundles={["alpha"]}
      />,
    );
    await act(async () => {
      await api.send?.("first");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        payload: { content: "ok" },
        session_id: "live-1",
      });
    });

    await act(async () => {
      api.setKnowledgeBundles?.(["alpha", "beta"]);
    });

    expect(api.knowledgeNotices).toContain("enabled “beta”");

  });

  it("does nothing when the selection is unchanged", async () => {
    dashboardMock.request.mockImplementation(async (method) => {
      if (method === "session.create") {
        return { session_id: "live-1", stored_session_id: "stored-1" };
      }
      if (method === "model.options") {
        return { model: "bad-model", provider: "bad-provider", providers: [] };
      }
      return {};
    });

    const api: HarnessApi = {};
    render(
      <Harness
        api={api}
        initialConnectionMode="local"
        initialKnowledgeBundles={["alpha"]}
      />,
    );
    await act(async () => {
      await api.send?.("first");
    });
    await act(async () => {
      dashboardMock.onEvent?.({
        type: "message.complete",
        payload: { content: "ok" },
        session_id: "live-1",
      });
    });
    dashboardMock.request.mockClear();


    // Same set, different order — must be a no-op.
    await act(async () => {
      api.setKnowledgeBundles?.(["alpha"]);
    });

    await act(async () => {
      await api.send?.("second");
    });
    const methods = dashboardMock.request.mock.calls.map((c) => c[0]);
    expect(methods).not.toContain("session.close");
    expect(api.knowledgeNotices ?? []).toHaveLength(0);
  });
});

/**
 * The large-context switch guard.
 *
 * Above `model.switch_context_confirm_tokens` the backend returns a confirm
 * request and applies nothing. The desktop has no surface to answer it, so the
 * transport must auto-approve — and must NOT report failure for a switch the
 * gateway then confirms. These strings are taken verbatim from the reported
 * failure so the real payload is what is tested.
 */
describe("large-context model switch guard", () => {
  const GUARD = {
    warning:
      "!!! LARGE CONTEXT MODEL SWITCH !!!\n\nThis session holds ~326,196 tokens of context.\nSwitching to cbai/deepseek-v4.1-flash makes the next reply re-read all of it uncached (providers key prompt caches per model) — a one-time full-price input cost.\n\nThreshold: model.switch_context_confirm_tokens (currently 100,000; 0 disables this check).\nConfirm only if you intend to switch now.",
    output: "",
  };
  const SUCCESS = {
    output:
      "✓ Model switched: cbai/deepseek-v4.1-flash\n    Provider: 9r\n    Context: 1,000,000 tokens\n    (session only — add --global to persist)",
    warning: "",
  };

  it("recognises the guard text", () => {
    expect(isModelSwitchConfirmation(GUARD)).toBe(true);
  });

  it("recognises the success text (and not as a guard)", () => {
    // The confirm text is the SIGNAL for the guard; the success line must not
    // be mistaken for it, or the transport would try to approve forever.
    expect(modelSwitchReportedSuccess(SUCCESS)).toBe(true);
    expect(isModelSwitchConfirmation(SUCCESS)).toBe(false);
  });

  it("does not treat a plain response as a guard", () => {
    expect(isModelSwitchConfirmation({ output: "hello" })).toBe(false);
    expect(isModelSwitchConfirmation(null)).toBe(false);
    expect(isModelSwitchConfirmation(undefined)).toBe(false);
  });

  it("does not treat an unrelated error as a confirmed switch", () => {
    expect(modelSwitchReportedSuccess({ output: "Unknown provider '9r'" })).toBe(
      false,
    );
    expect(modelSwitchReportedSuccess(null)).toBe(false);
  });

  it("trusts a confirmed switch even when the guard was raised first", () => {
    // THE reported bug: the guard fired, /approve applied the switch, the
    // backend reported success — and the transport still threw "did not
    // switch" because it verified against a lagging read. A confirmed success
    // must win.
    expect(modelSwitchReportedSuccess(SUCCESS)).toBe(true);
    // And the guard text alone must never count as success.
    expect(modelSwitchReportedSuccess(GUARD)).toBe(false);
  });
});
