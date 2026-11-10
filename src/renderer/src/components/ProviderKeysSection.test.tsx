// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../test/renderWithI18n";
import ProviderKeysSection from "./ProviderKeysSection";

// The provider card list is configuration data; the dialog is what these tests
// exercise, so the library calls stay empty and the key arrives through `env`.
const PROVIDER_KEY = "OPENROUTER_API_KEY";

function stubApi(): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listModels: vi.fn(async (): Promise<never[]> => []),
      onModelLibraryChanged: vi.fn(() => () => undefined),
      listCustomProviders: vi.fn(async () => []),
      onCustomProvidersChanged: vi.fn(() => () => undefined),
      discoverProviderModels: vi.fn(async () => ({ models: [] })),
      getProviderKeyStatus: vi.fn(async () => ({ state: "ok" })),
    },
  });
}

function mount(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <ProviderKeysSection
      items={[
        {
          key: PROVIDER_KEY,
          label: "OpenRouter API Key",
          type: "password",
          hint: "Keys are stored locally",
        },
      ]}
      env={{ [PROVIDER_KEY]: "sk-or-v1-1234567890abcdef" }}
      savedKey={null}
      visibleKeys={new Set<string>()}
      onChange={() => undefined}
      onBlur={() => undefined}
      onToggleVisibility={() => undefined}
      onRemove={async () => undefined}
      profile="default"
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  stubApi();
});

afterEach(cleanup);

describe("provider config dialog", () => {
  // @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
  it("opens the API-key editor when the masked key is clicked", async () => {
    const view = mount();
    fireEvent.click(await waitFor(() => view.getByText("OpenRouter")));

    const masked = await waitFor(() => view.getByTitle("Replace"));
    fireEvent.click(masked);

    const input = await waitFor(
      () => view.getByPlaceholderText("OpenRouter API Key") as HTMLInputElement,
    );
    expect(input.value).toBe("sk-or-v1-1234567890abcdef");
    expect(input.type).toBe("password");
  });

  // @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
  it("shows an empty editor for a provider with no key yet", async () => {
    const view = renderWithI18n(
      <ProviderKeysSection
        items={[
          {
            key: PROVIDER_KEY,
            label: "OpenRouter API Key",
            type: "password",
            hint: "Keys are stored locally",
          },
        ]}
        env={{}}
        savedKey={null}
        visibleKeys={new Set<string>()}
        onChange={() => undefined}
        onBlur={() => undefined}
        onToggleVisibility={() => undefined}
        onRemove={async () => undefined}
        profile="default"
      />,
    );
    // With no key configured the card does not exist yet: the provider is
    // reached through the Add-provider picker, which must open the same editor.
    fireEvent.click(await waitFor(() => view.getByText("Add provider")));
    const picker = await waitFor(() => view.getByText("OpenRouter"));
    fireEvent.click(picker);

    const input = await waitFor(
      () => view.getByPlaceholderText("OpenRouter API Key") as HTMLInputElement,
    );
    expect(input.value).toBe("");
  });
});
