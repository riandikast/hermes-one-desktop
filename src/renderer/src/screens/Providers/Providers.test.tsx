import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Providers from "./Providers";
import { SETTINGS_SECTIONS } from "../../constants";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/ProviderKeysSection", () => ({
  default: () => null,
}));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/RegistryBrowserModal", () => ({
  default: () => null,
}));
vi.mock("../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: (options: {
    enabled: boolean;
    refreshToken?: number;
  }) => ({
    models:
      options.enabled && options.refreshToken !== undefined
        ? ["gpt-discovered"]
        : [],
    status: "ok",
  }),
}));

beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getEnv: vi
        .fn()
        .mockResolvedValue({ OPENAI_API_KEY: "fixture-secret-not-searchable" }),
      getModelConfig: vi
        .fn()
        .mockResolvedValue({ provider: "openai", model: "gpt-a", baseUrl: "" }),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      getAccount: vi.fn().mockResolvedValue(null),
      onAccountChanged: vi.fn(() => () => {}),
      onModelLibraryChanged: vi.fn(() => () => {}),
      onCustomProvidersChanged: vi.fn(() => () => {}),
      addModel: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([
        {
          id: "a",
          name: "Fast model",
          model: "gpt-a",
          provider: "openai",
          baseUrl: "",
        },
        {
          id: "b",
          name: "Reasoning model",
          model: "gpt-b",
          provider: "openai",
          baseUrl: "",
        },
      ]),
      listCustomProviders: vi.fn().mockResolvedValue([]),
      setModelConfig: vi.fn().mockResolvedValue(true),
      getAuxiliaryConfig: vi.fn().mockResolvedValue([
        { task: "vision", provider: "auto", model: "", baseUrl: "" },
        {
          task: "compression",
          provider: "openai",
          model: "gpt-a",
          baseUrl: "",
        },
      ]),
      onConnectionConfigChanged: vi.fn(() => () => {}),
      setAuxiliaryTask: vi.fn().mockResolvedValue(true),
      resetAuxiliaryConfig: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockResolvedValue(64000),
      setConfig: vi.fn().mockResolvedValue(true),
      setEnv: vi.fn().mockResolvedValue(true),
      addCredentialPoolEntry: vi
        .fn()
        .mockResolvedValue([
          { id: "fixture", label: "Work", access_token: "fixture-pool-token" },
        ]),
      setCredentialPool: vi.fn().mockResolvedValue(true),
    },
  });
});

// @lat: [[provider-setup#Provider setup#Consistent credential surfaces]]
it("preserves credential editing and pool add/remove across redesigned panels", async () => {
  render(<Providers visible profile="fixture-profile" />);
  await screen.findByText("common.change");
  for (const section of SETTINGS_SECTIONS.filter(
    (section) => section.title !== "constants.sectionLlmProviders",
  )) {
    fireEvent.click(screen.getByRole("tab", { name: section.title }));
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveClass("provider-settings-panel");
    const field = section.items[0];
    const row = within(panel)
      .getByText(field.hint)
      .closest(".settings-key-row")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button"));
    const input = within(panel).getByLabelText(field.label);
    fireEvent.change(input, { target: { value: "fixture-edited-value" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(window.hermesAPI.setEnv).toHaveBeenCalledWith(
        field.key,
        "fixture-edited-value",
        "fixture-profile",
      ),
    );
  }
  fireEvent.click(
    screen.getByRole("tab", { name: "settings.sections.credentialPool" }),
  );
  const add = screen.getByRole("button", { name: "settings.add" });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "common.provider" }), {
    target: { value: "openai" },
  });
  fireEvent.change(screen.getByLabelText("settings.apiKeyPlaceholder"), {
    target: { value: "fixture-pool-token" },
  });
  fireEvent.change(screen.getByLabelText("settings.labelPlaceholder"), {
    target: { value: "Work" },
  });
  fireEvent.click(add);
  await screen.findByText("Work");
  expect(window.hermesAPI.addCredentialPoolEntry).toHaveBeenCalledWith(
    "openai",
    "fixture-pool-token",
    "Work",
  );
  expect(screen.getByLabelText("settings.apiKeyPlaceholder")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "settings.remove" }));
  await waitFor(() =>
    expect(window.hermesAPI.setCredentialPool).toHaveBeenCalledWith(
      "openai",
      [],
    ),
  );
  await waitFor(() =>
    expect(screen.queryByText("Work")).not.toBeInTheDocument(),
  );
});

// @lat: [[provider-setup#Provider setup#Focused settings tabs]]
it("separates all settings into keyboard-accessible tabs without the account card", async () => {
  render(<Providers visible />);
  await screen.findByText("common.change");
  expect(screen.getByText("common.defaultModel")).toBeInTheDocument();
  expect(screen.queryByText("common.activeModel")).not.toBeInTheDocument();
  expect(
    screen.queryByText("providers.hermesAccount.sectionTitle"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("providers.hermesAccount.signIn"),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(8);
  expect(
    within(screen.getByRole("tabpanel")).queryByText("settings.poolHint"),
  ).not.toBeInTheDocument();
  for (const title of [
    "settings.sections.credentialPool",
    "constants.sectionToolApiKeys",
    "constants.sectionBrowserAutomation",
    "constants.sectionVoiceStt",
    "constants.sectionResearchTraining",
    "providers.oauth.sectionTitle",
  ]) {
    fireEvent.click(screen.getByRole("tab", { name: title }));
    expect(
      within(screen.getByRole("tabpanel")).getByText(title),
    ).toBeInTheDocument();
    expect(screen.queryByText("common.defaultModel")).not.toBeInTheDocument();
  }
  fireEvent.keyDown(
    screen.getByRole("tab", { name: "providers.oauth.sectionTitle" }),
    { key: "Home" },
  );
  expect(
    screen.getByRole("tab", { name: "navigation.providers" }),
  ).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(
    screen.getByRole("tab", { name: "constants.auxiliaryTitle" }),
  ).toHaveAttribute("aria-selected", "true");
  await screen.findByRole("button", {
    name: "common.edit constants.auxiliaryVision",
  });
});

// @lat: [[provider-setup#Provider setup#Auxiliary routing editor]]
it("saves auxiliary overrides, restores focus, closes with Escape and resets", async () => {
  render(<Providers visible />);
  fireEvent.click(
    screen.getByRole("tab", { name: "constants.auxiliaryTitle" }),
  );
  const edit = await screen.findByRole("button", {
    name: "common.edit constants.auxiliaryVision",
  });
  edit.focus();
  fireEvent.click(edit);
  const dialog = screen.getByRole("dialog");
  const provider = within(dialog).getByLabelText(
    "constants.auxiliaryProviderLabel",
  );
  expect(provider).toHaveFocus();
  fireEvent.change(provider, { target: { value: "custom" } });
  const discovered = within(dialog).getByLabelText(
    "constants.auxiliaryModelLabel",
    { selector: "select" },
  );
  fireEvent.change(discovered, { target: { value: "gpt-discovered" } });
  expect(
    within(dialog).getByLabelText("constants.auxiliaryModelLabel", {
      selector: "input",
    }),
  ).toHaveValue("gpt-discovered");
  fireEvent.change(provider, { target: { value: "custom" } });
  fireEvent.change(
    within(dialog).getByLabelText("constants.auxiliaryModelLabel", {
      selector: "input",
    }),
    { target: { value: "manual-model" } },
  );
  fireEvent.change(
    within(dialog).getByLabelText("constants.auxiliaryBaseUrlLabel"),
    { target: { value: "https://example.test/v1" } },
  );
  fireEvent.click(within(dialog).getByText("common.save"));
  await waitFor(() =>
    expect(window.hermesAPI.setAuxiliaryTask).toHaveBeenCalledWith("vision", {
      provider: "custom",
      model: "manual-model",
      baseUrl: "https://example.test/v1",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(edit).toHaveFocus();
  fireEvent.click(edit);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("constants.auxiliaryResetAll"));
  await waitFor(() =>
    expect(window.hermesAPI.resetAuxiliaryConfig).toHaveBeenCalledOnce(),
  );
});

// @lat: [[provider-setup#Provider setup#Search the default model list]]
it("filters by name, model ID and provider, excludes credentials, restores the selection on clear", async () => {
  render(React.createElement(Providers));
  await screen.findByText("common.change");
  fireEvent.click(screen.getByText("common.change"));
  const search = await screen.findByRole("searchbox", {
    name: "Search models",
  });
  const select = screen.getByRole("combobox", { name: "common.model" });
  await waitFor(() => expect(select).toHaveValue("gpt-a"));
  fireEvent.change(search, { target: { value: " REASONING " } });
  expect(screen.getByRole("option", { name: "gpt-b" })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "gpt-a" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("providers.model.use")).toBeDisabled();
  fireEvent.change(select, { target: { value: "gpt-b" } });
  expect(screen.getByText("providers.model.use")).toBeEnabled();
  fireEvent.change(search, { target: { value: "GPT-A" } });
  expect(screen.getByRole("option", { name: "gpt-a" })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "openai" } });
  expect(within(select).getAllByRole("option")).toHaveLength(2);
  fireEvent.change(search, {
    target: { value: "fixture-secret-not-searchable" },
  });
  expect(
    screen.getByRole("option", { name: "No matching models" }),
  ).toBeInTheDocument();
  expect(screen.getByText("providers.model.use")).toBeDisabled();
  fireEvent.change(search, { target: { value: "" } });
  expect(select).toHaveValue("gpt-b");
  fireEvent.click(screen.getByText("common.cancel"));
  fireEvent.click(screen.getByText("common.change"));
  expect(await screen.findByRole("searchbox")).toHaveValue("");
});
