import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Setup from "./Setup";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/VerifyWarningBanner", () => ({
  default: () => null,
}));

const api = {
  setEnv: vi.fn(),
  upsertCustomProvider: vi.fn(),
  addModel: vi.fn(),
  setModelConfig: vi.fn(),
};
const complete = vi.fn();
function change(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function openCustom(): void {
  render(createElement(Setup, { onComplete: complete }));
  fireEvent.click(
    screen.getByRole("button", { name: "providers.keys.custom.title" }),
  );
}
function fill(): void {
  change("providers.keys.custom.namePlaceholder", "  Example Gateway  ");
  change("setup.serverUrl", "  https://gateway.example/v1  ");
  change("setup.customApiKeyLabel", "  fixture-only-key  ");
  change("setup.modelName", "  vendor/model-one  ");
}

beforeEach(() => {
  vi.clearAllMocks();
  api.setEnv.mockResolvedValue(undefined);
  api.upsertCustomProvider.mockResolvedValue({
    name: "Example Gateway",
    baseUrl: "https://gateway.example/v1",
  });
  api.addModel.mockResolvedValue({ id: "saved-model" });
  api.setModelConfig.mockResolvedValue(undefined);
  Object.defineProperty(window, "hermesAPI", {
    value: api,
    configurable: true,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("first setup custom provider", () => {
  // @lat: [[provider-setup#Provider setup#Custom provider during first setup]]
  it("persists the same named provider, key, library model and active route as Providers", async () => {
    openCustom();
    expect(screen.getByLabelText("setup.serverUrl")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "setup.continue" }),
    ).toBeDisabled();
    fill();
    expect(screen.getByLabelText("setup.customApiKeyLabel")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "common.show" }));
    expect(screen.getByLabelText("setup.customApiKeyLabel")).toHaveAttribute(
      "type",
      "text",
    );
    fireEvent.click(screen.getByRole("button", { name: "common.hide" }));
    fireEvent.click(screen.getByRole("button", { name: "setup.continue" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(api.setEnv).toHaveBeenCalledWith(
      "CUSTOM_PROVIDER_EXAMPLE_GATEWAY_KEY",
      "fixture-only-key",
    );
    expect(api.upsertCustomProvider).toHaveBeenCalledWith(undefined, {
      name: "Example Gateway",
      baseUrl: "https://gateway.example/v1",
    });
    expect(api.addModel).toHaveBeenCalledWith(
      "vendor/model-one",
      "custom",
      "vendor/model-one",
      "https://gateway.example/v1",
      undefined,
      "Example Gateway",
    );
    expect(api.setModelConfig).toHaveBeenCalledWith(
      "custom",
      "vendor/model-one",
      "https://gateway.example/v1",
    );
    expect(api.addModel.mock.invocationCallOrder[0]).toBeLessThan(
      api.setModelConfig.mock.invocationCallOrder[0],
    );
  });

  it.each([
    "providers.keys.custom.namePlaceholder",
    "setup.serverUrl",
    "setup.customApiKeyLabel",
    "setup.modelName",
  ])("requires %s before writing", async (label) => {
    openCustom();
    fill();
    change(label, "  ");
    expect(
      screen.getByRole("button", { name: "setup.continue" }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("setup.modelName"), {
      key: "Enter",
    });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(api.setEnv).not.toHaveBeenCalled();
    expect(api.upsertCustomProvider).not.toHaveBeenCalled();
    expect(api.setModelConfig).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    "not a URL",
    "file:///private",
    "ftp://gateway.example",
    "https://user:password@gateway.example/v1",
    "https://gateway.example/v1?key=fixture-only-key",
    "https://gateway.example/v1#key",
  ])("rejects unsafe endpoint %s before any writes", async (url) => {
    openCustom();
    fill();
    change("setup.serverUrl", url);
    fireEvent.click(screen.getByRole("button", { name: "setup.continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "setup.missingServerUrl",
    );
    expect(api.setEnv).not.toHaveBeenCalled();
    expect(api.upsertCustomProvider).not.toHaveBeenCalled();
  });

  it.each([
    "setEnv",
    "upsertCustomProvider",
    "addModel",
    "setModelConfig",
  ] as const)(
    "keeps failure in %s generic, retryable, absent from logs",
    async (method) => {
      const logs = [
        vi.spyOn(console, "log"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "debug"),
      ];
      api[method].mockRejectedValueOnce(
        new Error("fixture-only-key backend detail"),
      );
      openCustom();
      fill();
      fireEvent.click(screen.getByRole("button", { name: "setup.continue" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "setup.saveFailed",
      );
      expect(screen.queryByText(/fixture-only-key/)).not.toBeInTheDocument();
      expect(complete).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "setup.continue" }),
      ).toBeEnabled();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "setup.continue" }));
      await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    },
  );

  it("does not reuse or reveal a key after switching provider cards", () => {
    openCustom();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "common.show" }));
    fireEvent.click(
      screen.getByRole("button", { name: "constants.openrouterName" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "providers.keys.custom.title" }),
    );
    expect(screen.getByLabelText("setup.customApiKeyLabel")).toHaveValue("");
    expect(screen.getByLabelText("setup.customApiKeyLabel")).toHaveAttribute(
      "type",
      "password",
    );
  });
});
