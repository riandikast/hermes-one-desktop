// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FloatingDialog } from "./FloatingDialog";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

function measure(panel: HTMLElement): void {
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    left: 100, top: 80, width: 600, height: 400, right: 700, bottom: 480,
    x: 100, y: 80, toJSON: () => ({}),
  });
}

// @lat: [[commands-terminal#Commands store + built-in terminal#Floating working dialogs]]
it.each(["Terminal", "Web preview", "File explorer"])("resizes %s with touch without dismissing or remounting", (title) => {
  const close = vi.fn();
  const view = render(<FloatingDialog open title={title} onClose={close} keepMounted><input data-testid="state" defaultValue="keep" /></FloatingDialog>);
  const panel = screen.getByRole("dialog");
  measure(panel);
  const child = screen.getByTestId("state");
  const handle = screen.getByRole("button", { name: `Resize ${title}` });
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700, clientY: 480, pointerType: "touch" });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800, clientY: 530 });
  expect(panel.style.width).toBe("700px");
  expect(panel.style.height).toBe("450px");
  expect(panel.style.transform).toBe("translate(50px, 25px)");
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  expect(panel.className).not.toContain("is-resizing");
  fireEvent.click(view.container.querySelector(".terminal-dialog-overlay")!);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByTestId("state")).toBe(child);
});

it("clamps size to minimum and available viewport, supports keyboard resizing", () => {
  render(<FloatingDialog open title="Terminal" onClose={() => {}}><div /></FloatingDialog>);
  const panel = screen.getByRole("dialog");
  measure(panel);
  const handle = screen.getByRole("button", { name: "Resize Terminal" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(panel.style.width).toBe("616px");
  fireEvent.pointerDown(handle, { pointerId: 2, clientX: 700, clientY: 480 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 9000, clientY: 9000 });
  expect(panel.style.width).toBe("900px");
  expect(panel.style.height).toBe("664px");
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: -9000, clientY: -9000 });
  expect(panel.style.width).toBe("320px");
  expect(panel.style.height).toBe("200px");
  fireEvent.pointerUp(handle, { pointerId: 2 });
});

it("captures Ctrl+Shift+T only while the terminal is open, ignores repeat", () => {
  const create = vi.fn();
  const props = { title: "Terminal", onClose: vi.fn(), onNewSession: create };
  const view = render(<FloatingDialog {...props} open><input data-testid="terminal-input" /></FloatingDialog>);
  const input = screen.getByTestId("terminal-input");
  const shellKey = vi.fn();
  input.addEventListener("keydown", shellKey);
  fireEvent.keyDown(input, { key: "T", ctrlKey: true, shiftKey: true });
  expect(create).toHaveBeenCalledTimes(1);
  expect(shellKey).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "T", ctrlKey: true, shiftKey: true, repeat: true });
  fireEvent.keyDown(input, { key: "t", ctrlKey: true });
  expect(create).toHaveBeenCalledTimes(1);
  view.rerender(<FloatingDialog {...props} open={false}><input /></FloatingDialog>);
  fireEvent.keyDown(document, { key: "T", ctrlKey: true, shiftKey: true });
  expect(create).toHaveBeenCalledTimes(1);
});

it("keeps sidebar placement unchanged without a floating resize handle", () => {
  render(<FloatingDialog open placement="sidebar" title="Terminal" onClose={() => {}}><div /></FloatingDialog>);
  expect(screen.queryByRole("button", { name: "Resize Terminal" })).toBeNull();
});
