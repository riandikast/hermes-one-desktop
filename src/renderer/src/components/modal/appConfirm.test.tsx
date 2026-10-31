import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppModal, AppModalTitle } from "./AppModal";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const { appConfirm } = await vi.importActual<typeof import("./appConfirm")>("./appConfirm");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
});
afterEach(() => { document.querySelectorAll(".app-confirm").forEach((dialog) => dialog.remove()); vi.restoreAllMocks(); });
it("uses an in-page dialog, defaults to Cancel, safely renders text and restores input focus", async () => {
  const native = vi.spyOn(window, "confirm");
  const input = document.createElement("input"); document.body.append(input); input.focus();
  const result = appConfirm("Delete <img src=x onerror=alert(1)>?");
  const dialog = screen.getByRole("dialog", { name: "Confirm action" });
  expect(dialog.querySelector("img")).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await result).toBe(true); expect(native).not.toHaveBeenCalled();
  expect(input).toHaveFocus(); expect(dialog.isConnected).toBe(false); input.remove();
});
it("cancels Escape without bubbling to the parent and rejects overlapping requests", async () => {
  const parentEscape = vi.fn(); window.addEventListener("keydown", parentEscape);
  const first = appConfirm("first"); expect(await appConfirm("second")).toBe(false);
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
  expect(await first).toBe(false); expect(parentEscape).not.toHaveBeenCalled();
  window.removeEventListener("keydown", parentEscape);
});
it("lives inside the active Radix scope and fails closed when that scope disappears", async () => {
  const scope = document.createElement("div"); scope.setAttribute("role", "dialog"); scope.dataset.state = "open"; document.body.append(scope);
  const first = appConfirm("nested"); expect(scope.querySelector(".app-confirm")).toBeTruthy();
  scope.remove(); expect(await first).toBe(false);
  const next = appConfirm("next"); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(await next).toBe(false);
});
it("keeps confirmation focus inside a real AppModal scope and restores its input", async () => {
  const close = vi.fn();
  render(<AppModal open onOpenChange={close}><AppModalTitle>Parent modal</AppModalTitle><input aria-label="Parent input" /></AppModal>);
  const input = screen.getByRole("textbox", { name: "Parent input" });
  input.focus();
  const result = appConfirm("nested action");
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
  expect(await result).toBe(false);
  expect(close).not.toHaveBeenCalled(); expect(input).toHaveFocus();
});
it("denies native cancel, close and backdrop dismissal, restores focus on repeated use", async () => {
  const input = document.createElement("input"); document.body.append(input);
  for (const kind of ["cancel", "close", "backdrop"]) {
    input.focus();
    const result = appConfirm(kind);
    const dialog = screen.getByRole("dialog", { name: "Confirm action" });
    if (kind === "backdrop") fireEvent.click(dialog, { clientX: -1, clientY: -1 });
    else fireEvent(dialog, new Event(kind, { cancelable: true }));
    expect(await result).toBe(false); expect(input).toHaveFocus();
  }
  input.remove();
});
it("cancels on page exit and fails closed if the dialog cannot open", async () => {
  const first = appConfirm("exit"); window.dispatchEvent(new Event("pagehide")); expect(await first).toBe(false);
  vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementationOnce(() => { throw new Error("unavailable"); });
  expect(await appConfirm("failure")).toBe(false);
  await waitFor(() => expect(document.querySelector(".app-confirm")).toBeNull());
});
it("does not leave native confirmation triggers in shipped renderer code", () => {
  const root = join(process.cwd(), "src/renderer/src");
  const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : scan(path);
    return /\.(?:ts|tsx)$/.test(path) && !/\.test\./.test(path) && /\bwindow\.(?:confirm|alert)\s*\(/.test(readFileSync(path, "utf8")) ? [path] : [];
  });
  expect(scan(root)).toEqual([]);
});
