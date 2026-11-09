import { fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SettingsDataContext } from "./SettingsDataContext";
import type { SettingsData } from "./useSettingsData";
import AgentsPane from "./AgentsPane";

let config: Record<string, string | null>;
const getConfig = vi.fn(async (key: string) => config[key] ?? null);
const setConfig = vi.fn(async (key: string, value: string) => {
  config[key] = value;
  return true;
});
const getMoaConfig = vi.fn();
const saveMoaConfig = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  config = {
    "delegation.provider": "",
    "delegation.model": "google/gemini-3-flash-preview",
    "delegation.reasoning_effort": "high",
    "delegation.max_iterations": "250",
    "delegation.max_concurrent_children": "10",
    "delegation.child_timeout_seconds": "0",
    "delegation.max_spawn_depth": "1",
    "delegation.oneshot_max_children": "2",
  };
  getConfig.mockImplementation(async (key) => config[key] ?? null);
  setConfig.mockImplementation(async (key, value) => {
    config[key] = value;
    return true;
  });
  getMoaConfig.mockResolvedValue({
    default_preset: "default",
    active_preset: "",
    presets: {
      default: {
        reference_models: [{ provider: "openrouter", model: "a/ref" }],
        aggregator: { provider: "openrouter", model: "a/agg" },
        reference_temperature: 0.3,
        aggregator_temperature: null,
        reference_timeout: null,
        degraded_reference_policy: "loud",
        enabled: true,
      },
    },
  });
  saveMoaConfig.mockImplementation(async (payload: unknown) => payload);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConnectionConfig: vi.fn(async () => ({ mode: "local" })),
      getConfig,
      setConfig,
      getMoaConfig,
      saveMoaConfig,
    },
  });
});
afterEach(() => cleanup());

function pane(): React.JSX.Element {
  return (
    <SettingsDataContext.Provider value={{ profile: "default", connMode: "local" } as SettingsData}>
      <AgentsPane />
    </SettingsDataContext.Provider>
  );
}

it("opens on Subagents and saves one delegation key with the profile", async () => {
  const view = renderWithI18n(pane());
  await waitFor(() =>
    expect((view.getByLabelText("Iterations per subagent") as HTMLInputElement).value).toBe("250"),
  );
  expect((view.getByLabelText("Subagent model") as HTMLInputElement).value).toBe(
    "google/gemini-3-flash-preview",
  );
  fireEvent.change(view.getByLabelText("Iterations per subagent"), { target: { value: "40" } });
  fireEvent.click(view.getByRole("button", { name: "Save Iterations per subagent" }));
  await waitFor(() =>
    expect(setConfig).toHaveBeenCalledWith("delegation.max_iterations", "40", "default"),
  );
  await waitFor(() =>
    expect((view.getByLabelText("Iterations per subagent") as HTMLInputElement).value).toBe("40"),
  );
});

it("rejects a subagent number below the floor without writing", async () => {
  const view = renderWithI18n(pane());
  await waitFor(() =>
    expect((view.getByLabelText("Parallel subagents") as HTMLInputElement).value).toBe("10"),
  );
  fireEvent.change(view.getByLabelText("Parallel subagents"), { target: { value: "0" } });
  fireEvent.click(view.getByRole("button", { name: "Save Parallel subagents" }));
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
  expect(setConfig).not.toHaveBeenCalled();
});

it("edits the Mixture of Agents preset and saves the full document", async () => {
  const view = renderWithI18n(pane());
  fireEvent.click(view.getByRole("tab", { name: "Mixture of Agents" }));
  await waitFor(() => expect(getMoaConfig).toHaveBeenCalledWith("default"));
  await waitFor(() => expect(view.getByLabelText("Reference 1 provider")).toBeTruthy());
  expect((view.getByLabelText("Reference 1 provider") as HTMLInputElement).value).toBe("openrouter");

  fireEvent.change(view.getByLabelText("Aggregator model"), { target: { value: "a/agg2" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveMoaConfig).toHaveBeenCalledTimes(1));
  const [payload, profile] = saveMoaConfig.mock.calls[0] as [any, string];
  expect(profile).toBe("default");
  expect(payload.default_preset).toBe("default");
  expect(payload.presets.default.aggregator).toEqual({ provider: "openrouter", model: "a/agg2" });
  expect(payload.presets.default.reference_models).toEqual([
    { provider: "openrouter", model: "a/ref" },
  ]);
});

it("blocks saving MoA while a slot is incomplete", async () => {
  const view = renderWithI18n(pane());
  fireEvent.click(view.getByRole("tab", { name: "Mixture of Agents" }));
  await waitFor(() => expect(view.getByLabelText("Aggregator provider")).toBeTruthy());
  fireEvent.change(view.getByLabelText("Aggregator provider"), { target: { value: "" } });
  expect((view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(saveMoaConfig).not.toHaveBeenCalled();
});
