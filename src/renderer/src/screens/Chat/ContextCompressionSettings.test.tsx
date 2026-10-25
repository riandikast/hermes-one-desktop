import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextCompressionSettings } from "./ContextCompressionSettings";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const stored = new Map<string, string>();
const getConfig = vi.fn(async (key: string) => stored.get(key) ?? null);
const setConfig = vi.fn(async (key: string, value: string) => { stored.set(key, value); return true; });
beforeEach(() => {
  stored.clear();
  getConfig.mockClear();
  setConfig.mockReset().mockImplementation(async (key, value) => { stored.set(key, value); return true; });
  Object.assign(window, { hermesAPI: { getConfig, setConfig } });
});

// @lat: [[model-context#Model context window#Auto-compaction settings]]
it("persists a token ceiling and enabled state in the current profile, verifies both, restores on reopen", async () => {
  const view = render(<ContextCompressionSettings profile="work" />);
  const ceiling = await screen.findByRole("spinbutton");
  fireEvent.change(ceiling, { target: { value: "150000" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await screen.findByText("chat.contextCompressionSaved");
  expect(setConfig.mock.calls).toEqual([
    ["compression.threshold_tokens", "150000", "work"],
    ["compression.enabled", "false", "work"],
  ]);
  expect(getConfig).toHaveBeenCalledWith("compression.threshold_tokens", "work");
  expect(getConfig).toHaveBeenCalledWith("compression.enabled", "work");
  view.unmount();
  render(<ContextCompressionSettings profile="work" />);
  await waitFor(() => expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("150000"));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});

it("clears the optional cap without disabling native ratio-based auto-compaction", async () => {
  stored.set("compression.threshold_tokens", "150000");
  render(<ContextCompressionSettings />);
  const ceiling = await screen.findByRole("spinbutton");
  fireEvent.change(ceiling, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await screen.findByText("chat.contextCompressionSaved");
  expect(setConfig).toHaveBeenCalledWith("compression.threshold_tokens", "null", undefined);
  expect(setConfig).toHaveBeenCalledWith("compression.enabled", "true", undefined);
});

it.each(["-1", "1.5", "0"])("rejects invalid ceiling %s without writing", async (value) => {
  render(<ContextCompressionSettings />);
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value } });
  expect((screen.getByRole("button", { name: "common.save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(setConfig).not.toHaveBeenCalled();
});

it("shows read errors without presenting editable fabricated defaults", async () => {
  getConfig.mockRejectedValueOnce(new Error("offline"));
  render(<ContextCompressionSettings />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it.each(["rejected", "mismatch"])("never reports saved when persistence is %s", async (failure) => {
  if (failure === "rejected") setConfig.mockResolvedValue(false);
  else setConfig.mockResolvedValue(true);
  render(<ContextCompressionSettings />);
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "200000" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("chat.contextCompressionSaved")).toBeNull();
});
