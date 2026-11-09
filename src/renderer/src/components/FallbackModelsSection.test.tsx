import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../test/renderWithI18n";
import FallbackModelsSection from "./FallbackModelsSection";

let chain: Array<Record<string, string>>;
const getChain = vi.fn();
const setConfig = vi.fn();

const PROVIDERS = [
  {
    key: "brand:openrouter",
    brand: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    baseUrl: "",
    models: [{ model: "a/one" }, { model: "a/two" }],
  },
  {
    key: "brand:local",
    brand: "custom",
    label: "Local gateway",
    provider: "custom",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [{ model: "local-model" }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  chain = [{ provider: "openrouter", model: "a/one", base_url: "http://gw" }];
  getChain.mockImplementation(async () => chain.map((entry) => ({ ...entry })));
  setConfig.mockImplementation(async (_key: string, value: string) => {
    chain = JSON.parse(value) as Array<Record<string, string>>;
    return true;
  });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { getFallbackProviders: getChain, setConfig },
  });
});

it("loads the configured chain and lists it in order", async () => {
  const view = renderWithI18n(
    <FallbackModelsSection profile="default" providers={PROVIDERS} />,
  );
  await waitFor(() => expect(getChain).toHaveBeenCalledWith("default"));
  expect((view.getByLabelText("Fallback 1 provider") as HTMLSelectElement).value).toBe(
    "openrouter",
  );
  expect((view.getByLabelText("Fallback 1 model") as HTMLInputElement).value).toBe("a/one");
});

it("adds a row, saves the JSON chain and verifies the read-back", async () => {
  const view = renderWithI18n(
    <FallbackModelsSection profile="default" providers={PROVIDERS} />,
  );
  await waitFor(() => expect(view.getByText("Add fallback model")).toBeTruthy());
  fireEvent.click(view.getByText("Add fallback model"));
  fireEvent.change(view.getByLabelText("Fallback 2 provider"), {
    target: { value: "custom" },
  });
  fireEvent.change(view.getByLabelText("Fallback 2 model"), {
    target: { value: "local-model" },
  });
  fireEvent.click(view.getByText("Save chain"));

  await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(1));
  expect(setConfig.mock.calls[0][0]).toBe("fallback_providers");
  expect(JSON.parse(setConfig.mock.calls[0][1] as string)).toEqual([
    { provider: "openrouter", model: "a/one", base_url: "http://gw" },
    { provider: "custom", model: "local-model" },
  ]);
  // Initial load, the save's read-back check, then the post-save reload.
  expect(getChain).toHaveBeenCalledTimes(3);
  await waitFor(() => expect(view.getByText(/Saved\./)).toBeTruthy());
});

it("keeps unsupported keys from the stored entry when saving", async () => {
  chain = [
    { provider: "custom", model: "local-model", base_url: "http://127.0.0.1:1/v1", api_mode: "chat_completions" },
  ];
  const view = renderWithI18n(
    <FallbackModelsSection profile="default" providers={PROVIDERS} />,
  );
  await waitFor(() => expect(view.getByLabelText("Fallback 1 model")).toBeTruthy());
  fireEvent.change(view.getByLabelText("Fallback 1 model"), {
    target: { value: "local-model-2" },
  });
  fireEvent.click(view.getByText("Save chain"));
  await waitFor(() => expect(setConfig).toHaveBeenCalled());
  expect(JSON.parse(setConfig.mock.calls[0][1] as string)).toEqual([
    {
      base_url: "http://127.0.0.1:1/v1",
      api_mode: "chat_completions",
      provider: "custom",
      model: "local-model-2",
    },
  ]);
});

it("refuses to save a half-filled row instead of dropping it silently", async () => {
  const view = renderWithI18n(
    <FallbackModelsSection profile="default" providers={PROVIDERS} />,
  );
  await waitFor(() => expect(view.getByText("Add fallback model")).toBeTruthy());
  fireEvent.click(view.getByText("Add fallback model"));
  fireEvent.change(view.getByLabelText("Fallback 2 provider"), {
    target: { value: "openrouter" },
  });
  const save = view.getByText("Save chain") as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(view.getByText(/Every row needs a provider and a model/)).toBeTruthy();
});
