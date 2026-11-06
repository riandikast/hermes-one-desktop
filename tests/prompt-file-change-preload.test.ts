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
  it("forwards only the attached folder to read-only workspace capture", async () => {
    await import("../src/preload/index");
    const api = (ipc.exposed.get("hermesAPI") ?? window.hermesAPI) as typeof window.hermesAPI;
    await api.captureWorkspaceSnapshot("C:/repo/subfolder");
    expect(ipc.invoke).toHaveBeenLastCalledWith("capture-workspace-snapshot", "C:/repo/subfolder");
  });

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
