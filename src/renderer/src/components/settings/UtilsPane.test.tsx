import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import UtilsPane from "./UtilsPane";
import { readFileAutosaveDefault } from "./fileAutosave";
import { readSendConfirm } from "./sendConfirm";
import { readDefaultKnowledge } from "./defaultKnowledge";

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listKnowledgeBundles: vi.fn().mockResolvedValue([
      { name: "alpha", path: "/knowledge/alpha" },
      { name: "beta", path: "/knowledge/beta" },
    ]),
  };
});

const autosaveGroup = (): ReturnType<typeof within> =>
  within(screen.getByRole("group", { name: "Default file editor auto-save" }));
const confirmGroup = (): ReturnType<typeof within> =>
  within(screen.getByRole("group", { name: "Send prompt confirmation" }));

it("defaults file editor auto-save to on", () => {
  expect(readFileAutosaveDefault()).toBe(true);
  render(<UtilsPane />);
  expect(autosaveGroup().getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  expect(autosaveGroup().getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
});

it("persists the default and broadcasts it to open editors", () => {
  const changed = vi.fn();
  window.addEventListener("hermes-file-autosave-changed", changed);
  render(<UtilsPane />);
  fireEvent.click(autosaveGroup().getByRole("button", { name: "Off" }));
  expect(localStorage.getItem("hermes.fileEditor.autoSave")).toBe("false");
  expect(readFileAutosaveDefault()).toBe(false);
  expect(changed).toHaveBeenCalled();
  expect(autosaveGroup().getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(autosaveGroup().getByRole("button", { name: "On" }));
  expect(localStorage.getItem("hermes.fileEditor.autoSave")).toBe("true");
  window.removeEventListener("hermes-file-autosave-changed", changed);
});

it("lists the available knowledge bundles and saves the defaults", async () => {
  render(<UtilsPane />);
  const alpha = await screen.findByRole("checkbox", { name: "alpha" });
  const beta = screen.getByRole("checkbox", { name: "beta" });
  expect(alpha).not.toBeChecked();
  expect(beta).not.toBeChecked();

  fireEvent.click(alpha);
  fireEvent.click(beta);
  expect(readDefaultKnowledge()).toEqual(["alpha", "beta"]);
  expect(alpha).toBeChecked();
  expect(beta).toBeChecked();
  expect(localStorage.getItem("hermes.knowledge.defaults")).toBe(
    JSON.stringify(["alpha", "beta"]),
  );

  fireEvent.click(alpha);
  expect(readDefaultKnowledge()).toEqual(["beta"]);
});

it("ships send confirmation off and persists the opt-in", () => {
  expect(readSendConfirm()).toBe(false);
  render(<UtilsPane />);
  expect(confirmGroup().getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

  const changed = vi.fn();
  window.addEventListener("hermes-send-confirm-changed", changed);
  fireEvent.click(confirmGroup().getByRole("button", { name: "On" }));
  expect(localStorage.getItem("hermes.sendConfirm")).toBe("true");
  expect(readSendConfirm()).toBe(true);
  expect(changed).toHaveBeenCalled();
  expect(confirmGroup().getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(confirmGroup().getByRole("button", { name: "Off" }));
  expect(localStorage.getItem("hermes.sendConfirm")).toBe("false");
  expect(readSendConfirm()).toBe(false);
  window.removeEventListener("hermes-send-confirm-changed", changed);
});
