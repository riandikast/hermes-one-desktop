// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { decodeTerminalInput, encodeTerminalInput, TERMINAL_KEYS } from "./onFinishTerminal";
import { migrateOnFinishSelection, readOnFinishSelection, writeOnFinishSelection } from "./onFinish";
import { useOnFinishRunner } from "./useOnFinishRunner";
import { OnFinishChip } from "./OnFinishChip";
const target = { id: "existing-terminal", title: "Dev server" };
beforeEach(() => {
  localStorage.clear();
  Object.assign(window, { hermesAPI: {
    terminalWrite: vi.fn().mockResolvedValue({ ok: true }),
    commandRun: vi.fn(), listCommands: vi.fn().mockResolvedValue([]),
  } });
});
it.each(Object.entries(TERMINAL_KEYS))("sends %s to the chosen existing terminal", async (key, data) => {
  const id = encodeTerminalInput({ terminalId: target.id, title: target.title, key: key as keyof typeof TERMINAL_KEYS });
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [target]));
  await act(async () => { await result.current.runQueue([id], []); });
  expect(window.hermesAPI.terminalWrite).toHaveBeenCalledWith({ id: target.id, data });
  expect(window.hermesAPI.commandRun).not.toHaveBeenCalled();
});
it("fails visibly for a closed target without redirecting input", async () => {
  const id = encodeTerminalInput({ terminalId: target.id, title: target.title, key: "Ctrl+C" });
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [{ id: "other", title: "Other" }]));
  await act(async () => { await result.current.runQueue([id], []); });
  expect(result.current.state.lastError).toContain("closed");
  expect(window.hermesAPI.terminalWrite).not.toHaveBeenCalled();
});
it("respects cancellation guard and rejects malformed persisted actions", async () => {
  expect(decodeTerminalInput("terminal-input:v1:bad")).toBeNull();
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [target]));
  const id = encodeTerminalInput({ terminalId: target.id, title: target.title, key: "r" });
  await act(async () => { await result.current.runQueue([id], [], () => false); });
  expect(window.hermesAPI.terminalWrite).not.toHaveBeenCalled();
});
it("preserves session isolation and draft migration", () => {
  const id = encodeTerminalInput({ terminalId: target.id, title: target.title, key: "Enter" });
  writeOnFinishSelection([id], "draft");
  migrateOnFinishSelection("draft", "session");
  expect(readOnFinishSelection("session")).toEqual([id]);
  expect(readOnFinishSelection("other")).toEqual([]);
});
it("configures terminal input through the On-Finish dropdown", async () => {
  render(<OnFinishChip running={false} scope="chat" getLiveSessions={() => [target]} />);
  fireEvent.click(screen.getByRole("button", { name: /On-Finish/ }));
  await waitFor(() => expect(screen.getByLabelText("On-Finish terminal")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("On-Finish key"), { target: { value: "r + Enter" } });
  fireEvent.click(screen.getByRole("button", { name: "Add terminal input" }));
  expect(decodeTerminalInput(readOnFinishSelection("chat")[0])).toEqual({ terminalId: target.id, title: target.title, key: "r + Enter" });
});
