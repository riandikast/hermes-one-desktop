import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import UtilsPane from "./UtilsPane";
import { readFileAutosaveDefault } from "./fileAutosave";

beforeEach(() => {
  localStorage.clear();
});

it("defaults file editor auto-save to on", () => {
  expect(readFileAutosaveDefault()).toBe(true);
  render(<UtilsPane />);
  expect(screen.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
});

it("persists the default and broadcasts it to open editors", () => {
  const changed = vi.fn();
  window.addEventListener("hermes-file-autosave-changed", changed);
  render(<UtilsPane />);
  fireEvent.click(screen.getByRole("button", { name: "Off" }));
  expect(localStorage.getItem("hermes.fileEditor.autoSave")).toBe("false");
  expect(readFileAutosaveDefault()).toBe(false);
  expect(changed).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "On" }));
  expect(localStorage.getItem("hermes.fileEditor.autoSave")).toBe("true");
  window.removeEventListener("hermes-file-autosave-changed", changed);
});
