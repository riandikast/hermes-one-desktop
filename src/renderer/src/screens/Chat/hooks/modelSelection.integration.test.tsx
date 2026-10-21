import { execFileSync } from "node:child_process";
import chatSource from "../Chat.tsx?raw";
import ts from "typescript";
import { act } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useDashboardChatTransport } from "./useDashboardChatTransport";
import { useModelConfig, effectiveOverrideBaseUrl, effectiveProviderForModel } from "./useModelConfig";
import { renderWithI18n } from "../../../test/renderWithI18n";
import type { SessionModelOverride } from "../../../../../shared/model-override";

const wire = vi.hoisted(() => ({ request: vi.fn(), event: null as any }));
vi.mock("../dashboardGatewayClient", () => ({ DashboardGatewayClient: class {
  connected = true;
  connect = async () => {};
  private pending = new Set<(error: Error) => void>();
  close = () => { for (const reject of this.pending) reject(new Error("Hermes dashboard WebSocket closed")); this.pending.clear(); };
  request = (method: string, params: any) => new Promise((resolve, reject) => {
    this.pending.add(reject);
    Promise.resolve(wire.request(method, params)).then(resolve, reject).finally(() => this.pending.delete(reject));
  });
  constructor(options: any) { if ("onClose" in options) wire.event = options.onEvent; }
} }));

// Execute the actual Chat callbacks, including their ordering, against the real
// transport. Only the IPC/network boundary is simulated; identity refs are not.
const source = ts.createSourceFile("Chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string): string {
  let found = "";
  function visit(node: ts.Node): void {
    if (name === "onSwitchModel" && ts.isPropertyAssignment(node) && node.name.getText(source) === name) found = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(found.length).toBeGreaterThan(100);
  return ts.transpile(`(${found})`, { target: ts.ScriptTarget.ES2022 });
}
const manualSource = callback("handleSelectModel");
const automaticSource = callback("onSwitchModel");
const api: any = {};
const modelErrors: string[] = [];
function Harness(): null {
  const [sessionModelOverride, setSessionModelOverride] = useState<SessionModelOverride>();
  const sessionModelOverrideRef = useRef<SessionModelOverride | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const activeTurnRef = useRef<any>(null);
  const modelConfig = useModelConfig();
  const chatCurrentModel = sessionModelOverride?.model ?? modelConfig.currentModel;
  const chatCurrentProvider = sessionModelOverride?.provider ?? modelConfig.currentProvider;
  const chatCurrentBaseUrl = sessionModelOverride?.baseUrl ?? modelConfig.currentBaseUrl;
  // Trusted repository source only, never external or user-provided code.
  const bind = (body: string, transport?: unknown) => new Function("modelConfig", "sessionModelOverrideRef", "setSessionModelOverride", "isLoading", "dashboardTransport", "effectiveProviderForModel", "effectiveOverrideBaseUrl", `return ${body}`)(modelConfig, sessionModelOverrideRef, setSessionModelOverride, isLoading, transport, effectiveProviderForModel, effectiveOverrideBaseUrl);
  const onSwitchModel = bind(automaticSource);
  const dashboardTransport = useDashboardChatTransport({
    active: false, enabled: true, fallbackOnUnavailable: false, connectionMode: "local", activeTurnRef,
    hermesSessionId: null, contextFolder: null, knowledgeBundles: [], planMode: false,
    messages, sessionModelOverrideRef, model: chatCurrentModel,
    provider: chatCurrentProvider, modelBaseUrl: chatCurrentBaseUrl,
    setMessages, setIsLoading, setHermesSessionId: () => {}, setToolProgress: () => {}, setUsage: () => {}, onSwitchModel,
    onModelApplyError: (message) => modelErrors.push(message),
  });
  Object.assign(api, { ...dashboardTransport, select: bind(manualSource, dashboardTransport), shown: sessionModelOverride, sessionModelOverrideRef });
  return null;
}
afterEach(() => { localStorage.clear(); modelErrors.length = 0; });

it.each(["unsupported", "malformed", "confirmation", "contradictory", "missing-status", "timeout"])("fails visibly without submitting the wrong model: %s", async (failure) => {
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    getModelConfig: async () => ({ model: "primary", provider: "9r", baseUrl: "" }),
    listModels: async () => [], getEnv: async () => ({}),
    onConnectionConfigChanged: () => () => {}, onModelLibraryChanged: () => () => {},
    discoverProviderModels: async () => ({ models: [], status: "ok", cached: false }),
    startDashboard: async () => ({ connection: { wsUrl: "ws://fixture" }, running: true }),
    freshDashboardWsUrl: async () => "ws://fixture", getSessionMessages: async () => [],
  } });
  let mutations = 0;
  wire.request.mockReset().mockImplementation(async (method: string) => {
    if (method === "session.create") return { session_id: "live", stored_session_id: "stored" };
    if (method === "session.status") return failure === "missing-status" ? {} : { output: "Model: primary (9r)" };
    if (method === "model.options") return { model: "cx/gpt-6.1-sol", provider: "9r" };
    if (method === "config.set") {
      mutations++;
      if (failure === "unsupported") throw new Error("Unknown method config.set");
      if (failure === "timeout") throw new Error("config.set timed out");
      if (failure === "malformed") return {};
      return { key: "model", scope: "session", confirm_required: failure === "confirmation", output: "Model switched" };
    }
    return {};
  });
  const view = renderWithI18n(<Harness />);
  try {
    await act(async () => {});
    api.sessionModelOverrideRef.current = { provider: "9r", model: "cx/gpt-6.1-sol", baseUrl: "" };
    await act(async () => { await api.applyModelOverride("9r", "cx/gpt-6.1-sol"); });
    expect(modelErrors).toHaveLength(1);
    expect(mutations).toBe(failure === "confirmation" ? 2 : 1);
    await act(async () => { await api.sendMessage("must not submit"); });
    expect(wire.request.mock.calls.some(([method]) => method === "prompt.submit")).toBe(false);
    expect(wire.request.mock.calls.some(([method]) => method === "slash.exec")).toBe(false);
  } finally { view.unmount(); }
});

// @lat: [[model-selection#Ordinary manual switch architecture probe]]
it.each(["belowThreshold", "atThreshold"] as const)("ordinary pick after completed first prompt uses selected runtime (%s)", async (scenario) => {
  const probe = JSON.parse(execFileSync("python", ["scripts/probe-manual-model-switch.py"], { encoding: "utf8" }));
  const trace = probe[scenario];
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    getModelConfig: async () => ({ model: "primary", provider: "9r", baseUrl: "" }),
    listModels: async () => [], getEnv: async () => ({}),
    onConnectionConfigChanged: () => () => {}, onModelLibraryChanged: () => () => {},
    discoverProviderModels: async () => ({ models: [], status: "ok", cached: false }),
    startDashboard: async () => ({ connection: { wsUrl: "ws://fixture" }, running: true }),
    freshDashboardWsUrl: async () => "ws://fixture", getSessionMessages: async () => [],
  } });
  let runtime = "primary";
  const submitted: string[] = [];
  wire.request.mockReset().mockImplementation(async (method: string, params: any) => {
    if (method === "session.create" || method === "session.resume") return { session_id: "live", stored_session_id: "stored" };
    if (method === "session.status") return { output: `Model: ${runtime} (9r)` };
    if (method === "model.options") return { model: runtime, provider: "9r" };
    if (method === "session.active_list") return { sessions: [{ id: "live", status: "idle" }] };
    if (method === "subagent.list") return { subagents: [] };
    if (method === "slash.exec" && params.command.startsWith("/model")) {
      runtime = trace.nextTurnRuntime;
      return trace.slash;
    }
    if (method === "config.set" && params.key === "model") {
      expect(params.session_id).toBe("live");
      expect(params.value).toBe("cx/gpt-6.1-sol --provider 9r --session");
      const confirmed = params.confirm_expensive_model === true;
      runtime = confirmed ? trace.config.confirmedRuntime : trace.config.initialRuntime;
      return confirmed ? trace.config.confirmed : trace.config.initial;
    }
    // /approve cannot confirm a mirror-only return: no pending confirmation was installed.
    if (method === "prompt.submit") submitted.push(runtime);
    return {};
  });
  const view = renderWithI18n(<Harness />);
  try {
    await act(async () => {});
    await act(async () => { await api.sendMessage("first"); });
    await act(async () => { wire.event({ type: "message.complete", session_id: "live", payload: { content: "done" } }); });
    await act(async () => { api.select("9r", "cx/gpt-6.1-sol", ""); });
    expect(api.shown?.model).toBe("cx/gpt-6.1-sol");
    await act(async () => { await api.sendMessage("second"); });
    console.info(JSON.stringify({ scenario, status: trace.status, slash: trace.slash, submitted }));
    expect(submitted).toEqual(["primary", "cx/gpt-6.1-sol"]);
    const sets = wire.request.mock.calls.filter(([method]) => method === "config.set");
    expect(sets).toHaveLength(scenario === "atThreshold" ? 2 : 1);
    if (scenario === "atThreshold") expect(sets[1][1].confirm_expensive_model).toBe(true);
    expect(wire.request.mock.calls.some(([method]) => method === "slash.exec")).toBe(false);
  } finally { view.unmount(); }
});

it.each([false, true])("retry, Switch now, interrupt, manual pick preserves routing (delayed fallback: %s)", async (delayFallback) => {
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    getModelConfig: async () => ({ model: "primary", provider: "9r", baseUrl: "" }),
    listModels: async () => [], getEnv: async () => ({}),
    onConnectionConfigChanged: () => () => {}, onModelLibraryChanged: () => () => {},
    discoverProviderModels: async () => ({ models: [], status: "ok", cached: false }),
    startDashboard: async () => ({ connection: { wsUrl: "ws://fixture" }, running: true }),
    freshDashboardWsUrl: async () => "ws://fixture", getSessionMessages: async () => [],
  } });
  localStorage.setItem("hermes.chat.fallbackModels.v1", JSON.stringify({ models: [{ key: "fallback", provider: "9r", model: "fallback", baseUrl: "", label: "fallback" }] }));
  let live = "primary";
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const submitted: any[] = [];
  const slashRuntime: string[] = [];
  const applied: string[] = [];
  wire.request.mockReset().mockImplementation(async (method: string, params: any) => {
    if (method === "session.create" || method === "session.resume") return { session_id: "live", stored_session_id: "stored" };
    if (method === "session.status") return { output: `Model: ${live} (9r)` };
    if (method === "model.options") return { model: live, provider: "9r" };
    if (method === "session.interrupt") return { status: "interrupted" };
    if (method === "session.active_list") return { sessions: [{ id: "live", status: "idle" }] };
    if (method === "subagent.list") return { subagents: [] };
    if (method === "slash.exec") {
      if (params.command === "status") slashRuntime.push(live);
      return { output: `Model: ${live} (9r)` };
    }
    if (method === "config.set" && params.key === "model") {
      const target = params.value.split(" ")[0];
      if (target === "fallback" && delayFallback) await delayed;
      live = target;
      applied.push(target);
      return { key: "model", value: target, scope: "session", confirm_required: false };
    }
    if (method === "prompt.submit") submitted.push({ text: params.text, model: live });
    return {};
  });
  const view = renderWithI18n(<Harness />);
  try {
    await act(async () => {});
    await act(async () => { await api.sendMessage("original"); });
    await act(async () => { wire.event({ type: "thinking.delta", session_id: "live", payload: { text: "waiting on provider, retrying in 300s (attempt 1/3)" } }); });
    expect(api.providerWait).toBeTruthy();
    let switching!: Promise<void>;
    await act(async () => { switching = api.switchProviderNow(); });
    expect(wire.request.mock.calls.some(([m, p]) => m === "config.set" && p.value.includes("fallback"))).toBe(true);
    if (!delayFallback) {
      await act(async () => { await switching; });
      expect(live).toBe("fallback");
      expect(submitted.at(-1)?.model).toBe("fallback");
    }
    await act(async () => { api.abort(); });
    await act(async () => { api.select("9r", "cx/gpt-6.1-sol", ""); });
    expect(api.shown?.model).toBe("cx/gpt-6.1-sol");
    expect(api.sessionModelOverrideRef.current?.model).toBe("cx/gpt-6.1-sol");
    await act(async () => { release(); await switching; });
    // Old switch completion must not restore fallback after the explicit pick.
    expect(live).toBe("cx/gpt-6.1-sol");
    expect(submitted).toEqual(delayFallback ? [{ text: "original", model: "primary" }] : [{ text: "original", model: "primary" }, { text: "Continue. Original prompt: original", model: "fallback" }]);
    await act(async () => { await api.execSlash("/status", () => {}); await api.sendMessage("MANUAL"); });
    expect(slashRuntime).toEqual(["cx/gpt-6.1-sol"]);
    expect(wire.request.mock.calls.filter(([method, params]) => method === "config.set" && params.key === "model").at(-1)?.[1].value).toBe("cx/gpt-6.1-sol --provider 9r --session");
    expect(submitted.at(-1)).toEqual({ text: "MANUAL", model: "cx/gpt-6.1-sol" });
    expect(api.shown).toEqual({ provider: "9r", providerLabel: undefined, model: "cx/gpt-6.1-sol", baseUrl: "" });
    expect(api.sessionModelOverrideRef.current).toEqual(api.shown);
    expect(JSON.parse(localStorage.getItem("hermes.chat.fallbackModels.v1")!).models[0].model).toBe("fallback");
    console.info(JSON.stringify({ delayFallback, modelCommand: "/model cx/gpt-6.1-sol --provider 9r", slashRuntime, nextSubmit: submitted.at(-1), replayAfterInterrupt: false }));
    expect(applied.at(-1)).toBe("cx/gpt-6.1-sol");
  } finally { view.unmount(); }
});
