import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SettingsDataContext } from "./SettingsDataContext";
import type { SettingsData } from "./useSettingsData";
import AgentConfigPane from "./AgentConfigPane";
import { appConfirm } from "../modal/appConfirm";

vi.mock("../modal/appConfirm", () => ({ appConfirm: vi.fn(async () => true) }));
let config: Record<string, string>;
let mode: "local" | "remote" | "ssh";
const getConfig = vi.fn(async (key: string) => config[key] ?? null);
const setConfig = vi.fn(async (key: string, value: string) => { config[key] = value; return true; });
const discover = vi.fn(async () => [{ name: "user-installed", installed: true, active: false, description: "Plugin", envVars: [] }]);
const getShortcuts = vi.fn(async () => ({}));
const getKeepAwake = vi.fn(async () => ({ mode: "while-working" as const, active: false }));
const setKeepAwake = vi.fn(async (mode: "off" | "while-working" | "always") => ({ mode, active: mode === "always" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appConfirm).mockResolvedValue(true);
  config = {};
  mode = "local";
  getConfig.mockImplementation(async (key) => config[key] ?? null);
  setConfig.mockImplementation(async (key, value) => { config[key] = value; return true; });
  discover.mockResolvedValue([{ name: "user-installed", installed: true, active: false, description: "Plugin", envVars: [] }]);

  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    getConnectionConfig: vi.fn(async () => ({ mode })), getConfig, setConfig,
    discoverMemoryProviders: discover, getKeyboardShortcuts: getShortcuts,
    getKeepAwake, setKeepAwake,
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function pane(section: "advanced" | "memory" = "memory", profile = "selected"): React.JSX.Element {
  return <SettingsDataContext.Provider value={{ profile, connMode: mode } as SettingsData}><AgentConfigPane section={section} /></SettingsDataContext.Provider>;
}
async function loaded(): Promise<void> {
  await waitFor(() => expect((screen.getByLabelText("Persistent Memory") as HTMLInputElement).disabled).toBe(false));
}
function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

// @lat: [[advanced-memory-settings#Regression coverage#Profile persistence]]
it("loads defaults without writing and saves only the edited profile field, verified by read-back", async () => {
  renderWithI18n(pane());
  await loaded();
  expect(setConfig).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Persistent Memory") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Memory Character Limit") as HTMLInputElement).value).toBe("2200");
  openTab("Context");
  fireEvent.change(screen.getByLabelText("Compression Threshold"), { target: { value: "0.8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Compression Threshold" }));
  await screen.findByText(/Saved and verified/);
  expect(setConfig).toHaveBeenCalledExactlyOnceWith("compression.threshold", "0.8", "selected");
  expect(getConfig).toHaveBeenLastCalledWith("compression.threshold", "selected");
});

// @lat: [[advanced-memory-settings#Controls and persistence#Subpages as tabs]]
it("renders the official subpages as tabs without a duplicated group heading", async () => {
  renderWithI18n(pane());
  await loaded();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Memory", "Context"]);
  // The old stacked layout repeated "Persistent memory" above a row with the same label.
  expect(screen.queryByText("Persistent memory")).toBeNull();
  openTab("Context");
  expect(screen.queryByLabelText("Persistent Memory")).toBeNull();
  expect(screen.getByLabelText("Auto-Compression")).toBeTruthy();
});

it("renders every Advanced subpage as its own tab", async () => {
  renderWithI18n(pane("advanced"));
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Desktop", "Runtime", "Tools", "Terminal", "Output",
  ]);
});

it("changes Keep Awake from the Desktop tab and shows the stored mode", async () => {
  renderWithI18n(pane("advanced"));
  await waitFor(() => expect(screen.getByRole("radio", { name: "While working" })).toBeTruthy());
  expect(screen.getByRole("radio", { name: "While working" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("radio", { name: "Always" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Always" }).getAttribute("aria-checked")).toBe("true"));
  expect(setKeepAwake).toHaveBeenCalledExactlyOnceWith("always");
});

it("discovers providers dynamically and retains an undiscovered saved provider", async () => {
  config["memory.provider"] = "old-plugin";
  renderWithI18n(pane());
  await loaded();
  expect(screen.getByRole("option", { name: "user-installed" })).toBeTruthy();
  expect((screen.getByLabelText("Memory Provider") as HTMLSelectElement).value).toBe("old-plugin");
  fireEvent.change(screen.getByLabelText("Memory Provider"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Memory Provider" }));
  await screen.findByText(/Saved and verified/);
  expect(setConfig).toHaveBeenCalledWith("memory.provider", "", "selected");
});

it("keeps the built-in controls usable when provider discovery fails", async () => {
  discover.mockRejectedValueOnce(new Error("offline"));
  renderWithI18n(pane());
  await loaded();
  expect((screen.getByLabelText("Memory Provider") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Persistent Memory") as HTMLInputElement).disabled).toBe(false);
});

// @lat: [[advanced-memory-settings#Regression coverage#Validation and failed verification]]
it("rejects invalid numeric edits and never reports an unverified write as saved", async () => {
  renderWithI18n(pane());
  await loaded();
  openTab("Context");
  fireEvent.change(screen.getByLabelText("Compression Threshold"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Compression Threshold" }));
  await screen.findByRole("alert");
  expect(setConfig).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Compression Threshold"), { target: { value: "0.9" } });
  setConfig.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Save Compression Threshold" }));
  await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not save and verify"));
  expect(screen.queryByText(/Saved and verified/)).toBeNull();
});

it("surfaces failed loads and reloads without defaults being written", async () => {
  getConfig.mockRejectedValueOnce(new Error("read failed"));
  renderWithI18n(pane());
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  await loaded();
  expect(setConfig).not.toHaveBeenCalled();
});

// @lat: [[advanced-memory-settings#Regression coverage#Connection isolation]]
it.each(["remote", "ssh"] as const)("does not read or write local config for %s", async (connection) => {
  mode = connection;
  renderWithI18n(pane());
  await screen.findByText(/available for local connections only/);
  expect(getConfig).not.toHaveBeenCalled();
  expect(setConfig).not.toHaveBeenCalled();
});

it("confirms disabling all toolsets and discarding backend source edits", async () => {
  vi.mocked(appConfirm).mockResolvedValue(false);
  renderWithI18n(pane("advanced"));
  openTab("Tools");
  await waitFor(() => expect((screen.getByLabelText("Enabled Toolsets") as HTMLInputElement).value).toBe("hermes-cli"));
  fireEvent.change(screen.getByLabelText("Enabled Toolsets"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Enabled Toolsets" }));
  await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
  openTab("Desktop");
  await waitFor(() => expect((screen.getByRole("button", { name: "Save Local Changes During Updates" }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.change(screen.getByLabelText("Local Changes During Updates"), { target: { value: "discard" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Local Changes During Updates" }));
  await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(2));
  expect(setConfig).not.toHaveBeenCalled();
});
