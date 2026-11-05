import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(async () => true),
  exposed: new Map<string, unknown>(),
}));
vi.mock("electron", () => ({
  ipcRenderer: { invoke: ipc.invoke },
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => ipc.exposed.set(name, value) },
  webFrame: {},
  webUtils: {},
}));

describe("prompt-owned file-change preload contract", () => {
  it("forwards the explicit owner unchanged and returns persistence refusal", async () => {
    await import("../src/preload/index");
    const api = (ipc.exposed.get("hermesAPI") ?? window.hermesAPI) as typeof window.hermesAPI;
    const changes = [{ path: "a.txt", before: "old", after: "new" }];
    ipc.invoke.mockResolvedValueOnce(false);
    expect(await api.recordSessionFileChanges("session-a", changes, 123)).toBe(false);
    expect(ipc.invoke).toHaveBeenLastCalledWith("record-session-file-changes", "session-a", changes, 123);
    ipc.invoke.mockResolvedValueOnce(false);
    expect(await api.recordSessionFileChanges("session-a", changes)).toBe(false);
    expect(ipc.invoke).toHaveBeenLastCalledWith("record-session-file-changes", "session-a", changes, undefined);
  });
});
