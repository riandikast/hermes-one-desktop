import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Providers from "./Providers";

vi.mock("../../components/useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/ProviderKeysSection", () => ({ default: () => null }));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/RegistryBrowserModal", () => ({ default: () => null }));
vi.mock("../../hooks/useDiscoveredModels", () => ({ useDiscoveredModels: () => ({ models: [], status: "ok" }) }));

beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: {
    getEnv: vi.fn().mockResolvedValue({ OPENAI_API_KEY: "fixture-secret-not-searchable" }),
    getModelConfig: vi.fn().mockResolvedValue({ provider: "openai", model: "gpt-a", baseUrl: "" }),
    getCredentialPool: vi.fn().mockResolvedValue({}),
    getAccount: vi.fn().mockResolvedValue(null),
    onAccountChanged: vi.fn(() => () => {}),
    onModelLibraryChanged: vi.fn(() => () => {}),
    onCustomProvidersChanged: vi.fn(() => () => {}),
    addModel: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([
      { id: "a", name: "Fast model", model: "gpt-a", provider: "openai", baseUrl: "" },
      { id: "b", name: "Reasoning model", model: "gpt-b", provider: "openai", baseUrl: "" },
    ]),
    listCustomProviders: vi.fn().mockResolvedValue([]),
    setModelConfig: vi.fn().mockResolvedValue(true),
  } });
});

// @lat: [[provider-setup#Provider setup#Search the default model list]]
it("filters by name, model ID and provider, excludes credentials, restores the selection on clear", async () => {
  render(React.createElement(Providers));
  await screen.findByText("common.change");
  fireEvent.click(screen.getByText("common.change"));
  const search = await screen.findByRole("searchbox", { name: "Search models" });
  const select = screen.getByRole("combobox", { name: "common.model" });
  await waitFor(() => expect(select).toHaveValue("gpt-a"));
  fireEvent.change(search, { target: { value: " REASONING " } });
  expect(screen.getByRole("option", { name: "gpt-b" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "gpt-a" })).not.toBeInTheDocument();
  expect(screen.getByText("providers.model.use")).toBeDisabled();
  fireEvent.change(select, { target: { value: "gpt-b" } });
  expect(screen.getByText("providers.model.use")).toBeEnabled();
  fireEvent.change(search, { target: { value: "GPT-A" } });
  expect(screen.getByRole("option", { name: "gpt-a" })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "openai" } });
  expect(within(select).getAllByRole("option")).toHaveLength(2);
  fireEvent.change(search, { target: { value: "fixture-secret-not-searchable" } });
  expect(screen.getByRole("option", { name: "No matching models" })).toBeInTheDocument();
  expect(screen.getByText("providers.model.use")).toBeDisabled();
  fireEvent.change(search, { target: { value: "" } });
  expect(select).toHaveValue("gpt-b");
  fireEvent.click(screen.getByText("common.cancel"));
  fireEvent.click(screen.getByText("common.change"));
  expect(await screen.findByRole("searchbox")).toHaveValue("");
});
