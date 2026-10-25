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
  fireEvent.click(screen.getByRole("button", { name: "On-Finish key" }));
  fireEvent.click(screen.getByRole("option", { name: "Ctrl+R" }));
  fireEvent.click(screen.getByRole("button", { name: "Add terminal input" }));
  expect(decodeTerminalInput(readOnFinishSelection("chat")[0])).toEqual({ terminalId: target.id, title: target.title, key: "Ctrl+R", enter: false });
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [target]));
  await act(async () => { await result.current.runQueue(readOnFinishSelection("chat"), []); });
  expect(window.hermesAPI.terminalWrite).toHaveBeenCalledWith({ id: target.id, data: "\x12" });
});

it.each([false, true])("delivers literal text exactly, optional Enter %s", async (enter) => {
  render(<OnFinishChip running={false} scope="custom" getLiveSessions={() => [target]} />);
  fireEvent.click(screen.getByRole("button", { name: /On-Finish/ }));
  await screen.findByLabelText("On-Finish input type");
  fireEvent.change(screen.getByLabelText("On-Finish input type"), { target: { value: "text" } });
  fireEvent.change(screen.getByLabelText("On-Finish text"), { target: { value: " Ctrl+C 🙂 " } });
  if (enter) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Add terminal input" }));
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [target]));
  await act(async () => { await result.current.runQueue(readOnFinishSelection("custom"), []); });
  expect(window.hermesAPI.terminalWrite).toHaveBeenCalledWith({ id: target.id, data: " Ctrl+C 🙂 " + (enter ? "\r" : "") });
  expect(window.hermesAPI.commandRun).not.toHaveBeenCalled();
});
it("preserves old v1 actions and independent control byte expectations", async () => {
  const { result } = renderHook(() => useOnFinishRunner(vi.fn(), () => [target]));
  for (const [key, data] of [["Ctrl+C", "\x03"], ["Ctrl+Y", "\x19"], ["r", "r"], ["Enter", "\r"], ["r + Enter", "r\r"], ["Tab", "\t"], ["Escape", "\x1b"], ["Backspace", "\x7f"], ...Array.from({ length: 26 }, (_, i) => [`Ctrl+${String.fromCharCode(65+i)}`, String.fromCharCode(i+1)])]) {
    const id = "terminal-input:v1:" + encodeURIComponent(JSON.stringify({ terminalId: target.id, title: target.title, key }));
    await act(async () => { await result.current.runQueue([id], []); });
    expect(window.hermesAPI.terminalWrite).toHaveBeenLastCalledWith({ id: target.id, data });
  }
});
it("rejects ambiguous, unknown, oversized, control and malformed input", () => {
  for (const extra of [{ key: "Ctrl+AA" }, { key: "__proto__" }, { key: ["Enter"] }, { key: "Enter", text: "x" }, { text: "" }, { text: "x".repeat(257) }, { text: "a\nb" }, { text: "\x1b" }, { text: "\x80" }, { text: "ok", enter: "true" }, { text: "ok", extra: true }]) {
    const id = "terminal-input:v1:" + encodeURIComponent(JSON.stringify({ ...target, terminalId: target.id, id: undefined, ...extra }));
    expect(decodeTerminalInput(id)).toBeNull();
  }
  expect(() => encodeTerminalInput({ terminalId: target.id, title: target.title, text: "x".repeat(257) })).toThrow();
  expect(decodeTerminalInput(encodeTerminalInput({ terminalId: target.id, title: target.title, text: "界".repeat(256) }))).not.toBeNull();
});
it("keeps keys collapsed until opened and supports keyboard, focus and dismissal", async () => {
  const { container } = render(<OnFinishChip running={false} scope="keys" getLiveSessions={() => [target]} />);
  fireEvent.click(screen.getByRole("button", { name: /On-Finish/ }));
  const trigger = await screen.findByRole("button", { name: "On-Finish key" });
  expect(container.querySelector("datalist")).toBeNull();
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const list = screen.getByRole("listbox", { name: "On-Finish keys" });
  expect(list.querySelectorAll('[role="option"]')).toHaveLength(30);
  expect(document.activeElement?.textContent).toBe("Ctrl+C");
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement?.textContent).toBe("Backspace");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("Ctrl+A");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toBe("Backspace");
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(trigger.textContent).toContain("Backspace");
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Add terminal input" })).toBeTruthy();
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole("button", { name: "Add terminal input" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.blur(document.activeElement!, { relatedTarget: screen.getByRole("button", { name: "Add terminal input" }) });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("bounds the popup to available viewport space", async () => {
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 200, bottom: 230, left: 900 } as DOMRect);
  const { container } = render(<OnFinishChip running={false} scope="layout" getLiveSessions={() => [target]} />);
  fireEvent.click(screen.getByRole("button", { name: /On-Finish/ }));
  const popup = container.querySelector<HTMLElement>(".chat-onfinish-dropdown")!;
  expect(popup.style.position).toBe("fixed");
  expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(parseFloat(popup.style.top) + parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 6);
  rect.mockRestore();
});

it("keeps literal r distinct from control R and preserves queue order", async () => {
  render(<OnFinishChip running={false} scope="letters" getLiveSessions={() => [target]} />);
  fireEvent.click(screen.getByRole("button", { name: /On-Finish/ }));
  fireEvent.change(screen.getByLabelText("On-Finish input type"), { target: { value: "text" } });
  fireEvent.change(screen.getByLabelText("On-Finish text"), { target: { value: "r" } });
  fireEvent.click(screen.getByRole("button", { name: "Add terminal input" }));
  fireEvent.change(screen.getByLabelText("On-Finish input type"), { target: { value: "key" } });
  fireEvent.click(screen.getByRole("button", { name: "On-Finish key" }));
  fireEvent.click(screen.getByRole("option", { name: "Ctrl+R" }));
  fireEvent.click(screen.getByRole("button", { name: "Add terminal input" }));
  expect(readOnFinishSelection("letters").map(decodeTerminalInput)).toEqual([
    { terminalId: target.id, title: target.title, text: "r", enter: false },
    { terminalId: target.id, title: target.title, key: "Ctrl+R", enter: false },
  ]);
});
