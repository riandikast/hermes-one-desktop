import { act } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  MODEL_SWITCH_BUDGET,
  useDashboardChatTransport,
} from "./useDashboardChatTransport";
import { renderWithI18n } from "../../../test/renderWithI18n";

/**
 * A `/model` call whose reply never arrives (the gateway's slash worker is
 * restarted around model switches and can drop it) used to hold the serialized
 * application queue for the whole 600s slash budget. Every later pick queued
 * behind it, so the picker moved but no `/model` was ever sent and the backend
 * kept serving the previous model. The queue must advance on its ceiling.
 */
const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../dashboardGatewayClient", () => ({
  DashboardGatewayClient: class {
    connected = true;
    connect = async () => {};
    private pending = new Set<(error: Error) => void>();
    close = () => {
      for (const reject of this.pending) reject(new Error("Hermes dashboard WebSocket closed"));
      this.pending.clear();
    };
    request = (method: string, params: any) =>
      new Promise((resolve, reject) => {
        this.pending.add(reject);
        Promise.resolve(wire.request(method, params))
          .then(resolve, reject)
          .finally(() => this.pending.delete(reject));
      });
    constructor(options: any) {
      if ("onClose" in options) return;
    }
  },
}));

const api: any = {};
const errors: string[] = [];

function Harness(): null {
  const [messages, setMessages] = useState<any[]>([]);
  const activeTurnRef = useRef<any>(null);
  const sessionModelOverrideRef = useRef<any>(undefined);
  const transport = useDashboardChatTransport({
    active: false,
    enabled: true,
    fallbackOnUnavailable: false,
    connectionMode: "local",
    activeTurnRef,
    hermesSessionId: null,
    contextFolder: null,
    knowledgeBundles: [],
    planMode: false,
    messages,
    sessionModelOverrideRef,
    model: "primary",
    provider: "9r",
    modelBaseUrl: "",
    setMessages,
    setIsLoading: () => {},
    setHermesSessionId: () => {},
    setToolProgress: () => {},
    setUsage: () => {},
    onModelApplyError: (message: string) => errors.push(message),
  });
  Object.assign(api, { ...transport, overrideRef: sessionModelOverrideRef });
  return null;
}

const originalBudget = { ...MODEL_SWITCH_BUDGET };
afterEach(() => {
  Object.assign(MODEL_SWITCH_BUDGET, originalBudget);
  localStorage.clear();
});

it("a dropped /model reply cannot wedge the next model pick", async () => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getModelConfig: async () => ({ model: "primary", provider: "9r", baseUrl: "" }),
      listModels: async () => [],
      getEnv: async () => ({}),
      onConnectionConfigChanged: () => () => {},
      onModelLibraryChanged: () => () => {},
      discoverProviderModels: async () => ({ models: [], status: "ok", cached: false }),
      startDashboard: async () => ({ connection: { wsUrl: "ws://fixture" }, running: true }),
      freshDashboardWsUrl: async () => "ws://fixture",
      getSessionMessages: async () => [],
    },
  });
  // Keep the test fast without fake timers: production values are 20s/45s.
  MODEL_SWITCH_BUDGET.callMs = 25;
  MODEL_SWITCH_BUDGET.ceilingMs = 60;

  let live = "primary";
  const applied: string[] = [];
  wire.request.mockReset().mockImplementation(async (method: string, params: any) => {
    if (method === "session.create" || method === "session.resume") {
      return { session_id: "live", stored_session_id: "stored" };
    }
    if (method === "session.status") return { output: `Model: ${live} (9r)` };
    if (method === "model.options") return { model: live, provider: "9r" };
    if (method === "config.set" && params.key === "model") {
      const target = params.value.split(" ")[0];
      if (target === "first-target") {
        // The reply is dropped: the promise never settles.
        return new Promise(() => undefined);
      }
      if (target) {
        live = target;
        applied.push(target);
      }
      return { key: "model", value: live, scope: "session", confirm_required: false };
    }
    return {};
  });

  const view = renderWithI18n(<Harness />);
  try {
    await act(async () => {});
    const started = Date.now();
    // First pick hangs on a dropped reply.
    api.overrideRef.current = { provider: "9r", model: "first-target", baseUrl: "" };
    void api.applyModelOverride("9r", "first-target");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    // Second pick must reach the gateway rather than queue behind it forever.
    api.overrideRef.current = { provider: "9r", model: "second-target", baseUrl: "" };
    await act(async () => {
      await Promise.race([
        api.applyModelOverride("9r", "second-target"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("model queue wedged")), 1_500),
        ),
      ]);
    });
    const elapsed = Date.now() - started;
    console.info("[unwedge]", { elapsed, applied, live, errors });

    expect(applied).toContain("second-target");
    expect(live).toBe("second-target");
    // Bounded by the ceiling, nowhere near the old 600s budget.
    expect(elapsed).toBeLessThan(2_000);
  } finally {
    view.unmount();
  }
});
