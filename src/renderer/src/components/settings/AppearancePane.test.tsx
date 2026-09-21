// @vitest-environment jsdom
//
// The Appearance pane's auto-expand toggles. `Auto-expand tool calls` is the
// counterpart to `Auto-expand reasoning`, so the two are asserted together: the
// value must persist under its OWN key, and toggling one must not disturb the
// other.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppearancePane from "./AppearancePane";
import { ThemeProvider } from "../ThemeProvider";
import { FontProvider } from "../FontProvider";
import { I18nProvider } from "../I18nProvider";

beforeEach(() => {
  localStorage.clear();
  // ThemeProvider reads the prefers-color-scheme media query; jsdom has no
  // matchMedia, so stub a minimal listener-capable implementation.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    getGpuStatus: vi.fn().mockResolvedValue({
      preference: "auto",
      bootPreference: "auto",
      reason: "ok",
    }),
    setGpuPreference: vi.fn().mockResolvedValue(true),
    listSystemFonts: vi.fn().mockResolvedValue([]),
    relaunchApp: vi.fn(),
  };
});

function renderPane(): void {
  render(
    <I18nProvider>
      <ThemeProvider>
        <FontProvider>
          <AppearancePane />
        </FontProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/** The checkbox belonging to a settings row identified by its label text. */
function toggleFor(label: string): HTMLInputElement {
  const labelEl = [...document.querySelectorAll(".settings-row-label")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!labelEl) throw new Error(`no settings row labelled "${label}"`);
  const input = labelEl
    .closest(".settings-row")
    ?.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!input) throw new Error(`no toggle in row "${label}"`);
  return input;
}

describe("Appearance pane — auto-expand toggles", () => {
  it("renders the Auto-expand tool calls toggle", async () => {
    renderPane();
    await waitFor(() =>
      expect(
        screen.getByText("Auto-expand tool calls"),
      ).toBeDefined(),
    );
  });

  it("defaults to off", () => {
    renderPane();
    expect(toggleFor("Auto-expand tool calls").checked).toBe(false);
    expect(toggleFor("Auto-expand reasoning").checked).toBe(false);
  });

  it("persists tool-call expansion under its own key", () => {
    renderPane();
    fireEvent.click(toggleFor("Auto-expand tool calls"));

    expect(localStorage.getItem("hermes.autoExpandToolCalls")).toBe("true");
    // Must not write the reasoning key.
    expect(localStorage.getItem("hermes.autoExpandReasoning")).toBeNull();
    expect(toggleFor("Auto-expand tool calls").checked).toBe(true);
  });

  it("broadcasts a change so open tool rows re-read the setting", () => {
    renderPane();
    const heard: string[] = [];
    const listener = (): void => {
      heard.push("tool-calls");
    };
    window.addEventListener("hermes-auto-expand-tool-calls-changed", listener);
    try {
      fireEvent.click(toggleFor("Auto-expand tool calls"));
    } finally {
      window.removeEventListener(
        "hermes-auto-expand-tool-calls-changed",
        listener,
      );
    }
    expect(heard).toEqual(["tool-calls"]);
  });

  it("does not disturb the reasoning toggle", () => {
    renderPane();
    fireEvent.click(toggleFor("Auto-expand reasoning"));
    expect(localStorage.getItem("hermes.autoExpandReasoning")).toBe("true");

    fireEvent.click(toggleFor("Auto-expand tool calls"));

    // Both on, independently.
    expect(localStorage.getItem("hermes.autoExpandReasoning")).toBe("true");
    expect(localStorage.getItem("hermes.autoExpandToolCalls")).toBe("true");
    expect(toggleFor("Auto-expand reasoning").checked).toBe(true);
  });

  it("reflects a previously saved value on mount", async () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    renderPane();
    await waitFor(() =>
      expect(toggleFor("Auto-expand tool calls").checked).toBe(true),
    );
  });

  it("turns back off and clears the stored value", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    renderPane();
    fireEvent.click(toggleFor("Auto-expand tool calls"));
    expect(localStorage.getItem("hermes.autoExpandToolCalls")).toBe("false");
    expect(toggleFor("Auto-expand tool calls").checked).toBe(false);
  });
});
