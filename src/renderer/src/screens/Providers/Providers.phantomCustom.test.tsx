import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Providers from "./Providers";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/ProviderKeysSection", () => ({ default: () => null }));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/RegistryBrowserModal", () => ({ default: () => null }));
vi.mock("../../hooks/useDiscoveredModels", () => ({ useDiscoveredModels: () => ({ models: [], status: "ok" }) }));

const baseUrl = "https://9router.invalid/v1";

beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    // The active/default model belongs to a NAMED custom provider.
    getEnv: vi.fn().mockResolvedValue({ CUSTOM_PROVIDER_CBAI_KEY: "fixture-secret" }),
    getModelConfig: vi.fn().mockResolvedValue({ provider: "custom", model: "cbai/glm-5.3", baseUrl }),
    getCredentialPool: vi.fn().mockResolvedValue({}),
    getAccount: vi.fn().mockResolvedValue(null),
    onAccountChanged: vi.fn(() => () => {}),
    onModelLibraryChanged: vi.fn(() => () => {}),
    onCustomProvidersChanged: vi.fn(() => () => {}),
    addModel: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([
      { id: "a", name: "glm-5.3", model: "cbai/glm-5.3", provider: "custom", baseUrl, providerLabel: "cbai" },
    ]),
    listCustomProviders: vi.fn().mockResolvedValue([{ name: "cbai", baseUrl }]),
    setModelConfig: vi.fn().mockResolvedValue(true),
  } });
});

it("does not invent a second, unlabelled custom provider for the active named provider", async () => {
  render(React.createElement(Providers));
  await screen.findByText("common.change");
  fireEvent.click(screen.getByText("common.change"));
  const trigger = await waitFor(() => {
    const el = document.querySelector(".logo-select-trigger");
    if (!el) throw new Error("provider picker not ready");
    return el as HTMLElement;
  });
  fireEvent.click(trigger);

  // Exactly ONE provider group: the named one. A bare "Custom" group holding
  // only the active model is the reported phantom.
  const labels = Array.from(document.querySelectorAll(".logo-select-menu .logo-select-option"))
    .map((el) => el.textContent ?? "");
  expect(labels).toEqual(["cbai"]);

  // Selecting the same model again must not write an unlabelled library row.
  await waitFor(() => expect(screen.getByRole("combobox", { name: "common.model" })).toBeInTheDocument());
  const addModel = window.hermesAPI.addModel as unknown as ReturnType<typeof vi.fn>;
  await waitFor(() => {
    for (const call of addModel.mock.calls) {
      // args: name, provider, model, baseUrl, contextLength, providerLabel
      expect(call[5]).toBe("cbai");
    }
  }, { timeout: 4000 });
});

it("labels the library row from providers.json when the active row has no label", async () => {
  // Reported phantom: selecting the active/default model writes a library row
  // with no providerLabel, so the model dialog grows a generic "Custom" group
  // holding exactly that one model, next to the real named provider.
  (window.hermesAPI.getEnv as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  render(React.createElement(Providers));
  await screen.findByText("common.change");
  // The 2 s library auto-save must still know the endpoint belongs to `cbai`.
  const addModel = window.hermesAPI.addModel as unknown as ReturnType<typeof vi.fn>;
  await waitFor(() => expect(addModel).toHaveBeenCalled(), { timeout: 4000 });
  for (const call of addModel.mock.calls) {
    expect(call[5]).toBe("cbai");
  }
});
