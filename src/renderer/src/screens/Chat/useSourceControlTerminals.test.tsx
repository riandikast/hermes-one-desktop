import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSourceControlTerminals } from "./useSourceControlTerminals";
import type { TerminalDockHandle } from "../Command/TerminalDock";

beforeEach(() => {
  let n = 0;
  Object.assign(window, { hermesAPI: {
    terminalCreate: vi.fn().mockImplementation(async () => ({ id: `owned-${++n}`, shell: "pwsh" })),
    terminalKill: vi.fn().mockResolvedValue({ ok: true }),
  } });
});
afterEach(() => vi.restoreAllMocks());

it("toggles without killing or recreating shells, hides after the last close", async () => {
  const hook = renderHook(() => useSourceControlTerminals("/repo", vi.fn(), vi.fn()));
  attach(hook.result.current.dock);
  await act(async () => hook.result.current.toggle());
  expect(hook.result.current.visible).toBe(true);
  act(() => hook.result.current.toggle());
  expect(hook.result.current.visible).toBe(false);
  expect(hook.result.current.mounted).toBe(true);
  expect(window.hermesAPI.terminalKill).not.toHaveBeenCalled();
  act(() => hook.result.current.toggle());
  expect(hook.result.current.visible).toBe(true);
  expect(window.hermesAPI.terminalCreate).toHaveBeenCalledOnce();
  await act(async () => hook.result.current.add());
  act(() => hook.result.current.closed("owned-1"));
  expect(hook.result.current.visible).toBe(true);
  act(() => hook.result.current.closed("owned-2"));
  expect(hook.result.current.visible).toBe(false);
  await act(async () => hook.result.current.toggle());
  expect(window.hermesAPI.terminalCreate).toHaveBeenCalledTimes(3);
});

it("allows hiding a pending spawn and hides on spawn failure", async () => {
  let finish!: (value: { id: string; shell: string }) => void;
  vi.mocked(window.hermesAPI.terminalCreate).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useSourceControlTerminals("/repo", vi.fn(), vi.fn()));
  attach(hook.result.current.dock);
  act(() => hook.result.current.toggle());
  act(() => hook.result.current.toggle());
  await act(async () => finish({ id: "pending-hidden", shell: "pwsh" }));
  expect(hook.result.current.visible).toBe(false);
  act(() => hook.result.current.closed("pending-hidden"));
  vi.mocked(window.hermesAPI.terminalCreate).mockRejectedValueOnce(new Error("spawn failed"));
  await act(async () => hook.result.current.toggle());
  expect(hook.result.current.visible).toBe(false);
});
function attach(ref: React.RefObject<TerminalDockHandle | null>): ReturnType<typeof vi.fn> {
  const attachSession = vi.fn();
  ref.current = { attachSession } as unknown as TerminalDockHandle;
  return attachSession;
}

it("owns multiple shells in the repository, confirms close, preserves on cancel and kills only owned sessions", async () => {
  const close = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const hook = renderHook(() => useSourceControlTerminals("/repo", close, vi.fn()));
  const attached = attach(hook.result.current.dock);
  await act(async () => hook.result.current.add());
  await act(async () => hook.result.current.add());
  expect(window.hermesAPI.terminalCreate).toHaveBeenCalledWith({ cwd: "/repo", cols: 80, rows: 24 });
  expect(attached).toHaveBeenCalledTimes(2);
  await act(async () => { expect(await hook.result.current.requestClose()).toBe(false); });
  expect(close).not.toHaveBeenCalled();
  expect(window.hermesAPI.terminalKill).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await act(async () => { expect(await hook.result.current.requestClose()).toBe(true); });
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("owned-1");
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("owned-2");
  expect(close).toHaveBeenCalledOnce();
  hook.unmount();
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledTimes(2);
});

it("preserves a shell spawned during a pending confirmation when closing is cancelled", async () => {
  let finishSpawn!: (value: { id: string; shell: string }) => void;
  let finishConfirm!: (value: boolean) => void;
  vi.mocked(window.hermesAPI.terminalCreate).mockReturnValue(new Promise((resolve) => { finishSpawn = resolve; }));
  const confirmModule = await import("../../components/modal/appConfirm");
  vi.spyOn(confirmModule, "appConfirm").mockImplementationOnce(() => new Promise((resolve) => { finishConfirm = resolve; }));
  const close = vi.fn();
  const hook = renderHook(() => useSourceControlTerminals("/repo", close, vi.fn()));
  const attached = attach(hook.result.current.dock);
  act(() => hook.result.current.add());
  let closing!: Promise<boolean>;
  act(() => { closing = hook.result.current.requestClose(); });
  await act(async () => finishSpawn({ id: "spawn-during-confirm", shell: "pwsh" }));
  expect(attached).toHaveBeenCalledOnce();
  expect(window.hermesAPI.terminalKill).not.toHaveBeenCalled();
  await act(async () => { finishConfirm(false); expect(await closing).toBe(false); });
  expect(close).not.toHaveBeenCalled();
  expect(hook.result.current.visible).toBe(true);
});

it("guards duplicate creates, terminates late replies after close, and does not attach them", async () => {
  let finish!: (value: { id: string; shell: string }) => void;
  vi.mocked(window.hermesAPI.terminalCreate).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const close = vi.fn();
  const hook = renderHook(() => useSourceControlTerminals("/repo", close, vi.fn()));
  const attached = attach(hook.result.current.dock);
  act(() => { hook.result.current.add(); hook.result.current.add(); });
  expect(window.hermesAPI.terminalCreate).toHaveBeenCalledOnce();
  await act(async () => { await hook.result.current.requestClose(); });
  await act(async () => finish({ id: "late", shell: "pwsh" }));
  expect(attached).not.toHaveBeenCalled();
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("late");
  expect(close).toHaveBeenCalledOnce();
});

it("cleans up live and pending sessions on forced unmount", async () => {
  const hook = renderHook(() => useSourceControlTerminals("/repo", vi.fn(), vi.fn()));
  attach(hook.result.current.dock);
  await act(async () => hook.result.current.add());
  let finish!: (value: { id: string; shell: string }) => void;
  vi.mocked(window.hermesAPI.terminalCreate).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  act(() => hook.result.current.add());
  hook.unmount();
  await act(async () => finish({ id: "late-unmount", shell: "pwsh" }));
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("owned-1");
  expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("late-unmount");
});

it("does not confirm after individual tabs close, surfaces spawn/kill failures", async () => {
  const close = vi.fn(); const report = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const hook = renderHook(() => useSourceControlTerminals("/repo", close, report));
  attach(hook.result.current.dock);
  vi.mocked(window.hermesAPI.terminalCreate).mockRejectedValueOnce(new Error("spawn failed"));
  await act(async () => hook.result.current.add());
  expect(report).toHaveBeenCalledWith(expect.stringContaining("spawn failed"));
  await act(async () => hook.result.current.add());
  vi.mocked(window.hermesAPI.terminalKill).mockResolvedValueOnce({ ok: false });
  await act(async () => { expect(await hook.result.current.requestClose()).toBe(false); });
  expect(close).not.toHaveBeenCalled();
  hook.result.current.closed("owned-1");
  confirm.mockClear();
  await act(async () => { await hook.result.current.requestClose(); });
  expect(confirm).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
