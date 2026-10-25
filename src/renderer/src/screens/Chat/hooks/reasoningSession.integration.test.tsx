import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { useDashboardChatTransport } from "./useDashboardChatTransport";
const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../dashboardGatewayClient", () => ({ DashboardGatewayClient: class {
  connected = true;
  connect = async () => {};
  close = () => {};
  request = (method: string, params: any) => wire.request(method, params);
} }));
import { expect, it, vi } from "vitest";
import { useReasoningEffort } from "./useReasoningEffort";
import { submitDashboardPromptWithRecovery } from "./useDashboardChatTransport";

// @lat: [[reasoning-effort#Session isolation verification]]
it("isolates drafts, migrates to real ids, restores remounts, sends session-scoped reasoning before prompts", async () => {
  localStorage.clear();
  const setConfig = vi.fn();
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: { getConfig: async () => "medium", setConfig } });
  const a = renderHook(({ id }) => useReasoningEffort("default", id, "draft-a"), { initialProps: { id: null as string | null } });
  const b = renderHook(() => useReasoningEffort("default", null, "draft-b"));
  await act(async () => { await a.result.current.setReasoningEffort("high"); });
  expect(b.result.current.reasoningEffort).toBe("auto");
  expect(setConfig).not.toHaveBeenCalled();
  a.rerender({ id: "stored-a" });
  expect(a.result.current.reasoningEffort).toBe("high");
  a.unmount();
  const restored = renderHook(() => useReasoningEffort("default", "stored-a", "reopened"));
  expect(restored.result.current.reasoningEffort).toBe("high");
  const request = vi.fn(async (method: string, params: any) => method === "config.get" ? { value: "medium" } : method === "config.set" ? { value: params.value } : {});
  await submitDashboardPromptWithRecovery({ request } as any, { sessionId: "runtime-a", text: "hello", reasoningEffort: restored.result.current.reasoningEffort } as any);
  expect(request.mock.calls).toEqual([
    ["config.get", { key: "reasoning", session_id: "runtime-a" }],
    ["config.set", { key: "reasoning", value: "high", scope: "session", session_id: "runtime-a" }],
    ["prompt.submit", { session_id: "runtime-a", text: "hello" }],
  ]);
  const client = { request } as any;
  request.mockClear();
  await submitDashboardPromptWithRecovery(client, { sessionId: "runtime-b", text: "other", reasoningEffort: b.result.current.reasoningEffort });
  expect(request.mock.calls).toEqual([["prompt.submit", { session_id: "runtime-b", text: "other" }]]);
  b.unmount(); restored.unmount();
});

it("reapplies reasoning to recovered ids and blocks prompts on rejected effort", async () => {
  const request = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === "config.get") return { value: "medium" };
    if (method === "config.set") return { value: params.value };
    if (method === "prompt.submit" && params.session_id === "old") throw new Error("Session not found");
    if (method === "session.resume") return { session_id: "new" };
    return {};
  });
  await submitDashboardPromptWithRecovery({ request }, { sessionId: "old", storedSessionId: "stored", text: "retry", reasoningEffort: "ultra" });
  expect(request.mock.calls.slice(-2)).toEqual([
    ["config.set", { key: "reasoning", value: "ultra", scope: "session", session_id: "new" }],
    ["prompt.submit", { session_id: "new", text: "retry" }],
  ]);
  request.mockReset().mockResolvedValue({ value: "low" });
  await expect(submitDashboardPromptWithRecovery({ request }, { sessionId: "reject", text: "blocked", reasoningEffort: "high" })).rejects.toThrow("did not confirm");
  expect(request.mock.calls.some(([method]) => method === "prompt.submit")).toBe(false);
});

it("threads the selected effort through the actual send hook, not a prompt parameter", async () => {
  localStorage.clear();
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    startDashboard: async () => ({ connection: { wsUrl: "ws://fixture" }, running: true }),
    freshDashboardWsUrl: async () => "ws://fixture", getSessionMessages: async () => [],
  } });
  wire.request.mockReset().mockImplementation(async (method: string, params: any) => {
    if (method === "session.create") return { session_id: "live", stored_session_id: "stored" };
    if (method === "config.get") return { value: "medium" };
    if (method === "config.set") return { value: params.value };
    if (method === "session.active_list") return { sessions: [] };
    return {};
  });
  const view = renderHook(() => {
    const activeTurnRef = useRef<any>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const effort = useReasoningEffort("default", null, "wire-draft");
    const transport = useDashboardChatTransport({ active: false, enabled: true, fallbackOnUnavailable: false,
      connectionMode: "local", activeTurnRef, hermesSessionId: null, contextFolder: null,
      messages, setMessages, setIsLoading: () => {}, setHermesSessionId: () => {},
      setToolProgress: () => {}, setUsage: () => {}, reasoningEffort: effort.reasoningEffort });
    return { ...effort, ...transport };
  });
  await act(async () => { await view.result.current.setReasoningEffort("max"); });
  await act(async () => { await view.result.current.sendMessage("proof"); });
  const calls = wire.request.mock.calls;
  const mutation = calls.findIndex(([m, p]) => m === "config.set" && p.key === "reasoning");
  const submit = calls.findIndex(([m]) => m === "prompt.submit");
  expect(mutation).toBeGreaterThan(-1);
  expect(submit).toBeGreaterThan(mutation);
  expect(calls[mutation][1]).toEqual({ key: "reasoning", value: "max", scope: "session", session_id: "live" });
  expect(calls[submit][1]).toEqual({ session_id: "live", text: "proof" });
  view.unmount();
});
