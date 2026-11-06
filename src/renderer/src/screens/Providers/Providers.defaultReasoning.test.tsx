import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Providers from "./Providers";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("../../components/ProviderKeysSection", () => ({ default: () => null }));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/RegistryBrowserModal", () => ({ default: () => null }));
vi.mock("../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: () => ({ models: [], status: "ok" }),
}));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getEnv: vi.fn().mockResolvedValue({}),
      getModelConfig: vi
        .fn()
        .mockResolvedValue({ provider: "openai", model: "gpt-a", baseUrl: "" }),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      getAccount: vi.fn().mockResolvedValue(null),
      onAccountChanged: vi.fn(() => () => {}),
      onModelLibraryChanged: vi.fn(() => () => {}),
      onCustomProvidersChanged: vi.fn(() => () => {}),
      addModel: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      listCustomProviders: vi.fn().mockResolvedValue([]),
      setModelConfig: vi.fn().mockResolvedValue(true),
      getAuxiliaryConfig: vi.fn().mockResolvedValue([]),
      onConnectionConfigChanged: vi.fn(() => () => {}),
      setAuxiliaryTask: vi.fn().mockResolvedValue(true),
      resetAuxiliaryConfig: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockResolvedValue(64000),
      setConfig: vi.fn().mockResolvedValue(true),
      setEnv: vi.fn().mockResolvedValue(true),
      setCredentialPool: vi.fn().mockResolvedValue(true),
      addCredentialPoolEntry: vi.fn().mockResolvedValue([]),
    },
  });
});

it("sets the default thinking level from the Providers page without touching provider config", async () => {
  render(<Providers visible profile="fixture-profile" />);
  const select = (await screen.findByLabelText("Reasoning level")) as HTMLSelectElement;
  expect(select.value).toBe("auto");
  expect([...select.options].map((option) => option.value)).toEqual([
    "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
  ]);
  fireEvent.change(select, { target: { value: "high" } });
  expect(localStorage.getItem("hermes.reasoning.default")).toBe("high");
  expect(select.value).toBe("high");
  await waitFor(() => expect(screen.getByText("common.saved")).toBeInTheDocument());
  expect(window.hermesAPI.setConfig).not.toHaveBeenCalled();
  expect(window.hermesAPI.setAuxiliaryTask).not.toHaveBeenCalled();
  expect(window.hermesAPI.setModelConfig).not.toHaveBeenCalled();
});

it("restores the saved default when the page is reopened", async () => {
  localStorage.setItem("hermes.reasoning.default", "xhigh");
  render(<Providers visible profile="fixture-profile" />);
  expect(((await screen.findByLabelText("Reasoning level")) as HTMLSelectElement).value).toBe("xhigh");
});
