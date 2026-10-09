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

describe("Appearance pane — terminal shell row", () => {
  // The row is USELESS if the main process has no preference IPC: `terminalShell`
  // stays null and the row hides itself. So the tests supply the bridge.
  function withTerminalApi(preference: "powershell" | "cmd") {
    (window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI = {
      ...((window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI ?? {}),
      getTerminalPreference: vi.fn().mockResolvedValue(preference),
      setTerminalPreference: vi.fn().mockResolvedValue(true),
    };
  }

  /** The segmented control inside the row carrying `label`. */
  function segButtonsFor(label: string): HTMLButtonElement[] {
    const labelEl = [...document.querySelectorAll(".settings-row-label")].find(
      (el) => el.textContent?.trim() === label,
    );
    if (!labelEl) throw new Error(`no settings row labelled "${label}"`);
    return [
      ...(labelEl
        .closest(".settings-row")
        ?.querySelectorAll<HTMLButtonElement>(".settings-seg-btn") ?? []),
    ];
  }

  it("renders above the rounded-corners toggle", async () => {
    withTerminalApi("powershell");
    renderPane();
    await waitFor(() =>
      expect(segButtonsFor("Windows terminal shell")).toHaveLength(2),
    );

    // Order matters: the user asked for this row ABOVE rounded corners.
    const group = document.querySelector(".settings-group");
    const labels = [...(group?.querySelectorAll(".settings-row-label") ?? [])].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels.indexOf("Windows terminal shell")).toBe(0);
    expect(labels.indexOf("Rounded corners")).toBe(1);
  });

  it("uses the shared segmented control, not a bare select", async () => {
    withTerminalApi("powershell");
    renderPane();
    await waitFor(() =>
      expect(segButtonsFor("Windows terminal shell")).toHaveLength(2),
    );

    // Consistency with the font / hardware-acceleration rows is the point: a
    // raw <select> inherited none of the settings-group theming.
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(segButtonsFor("Windows terminal shell").map((b) => b.textContent)).toEqual([
      "PowerShell",
      "Command Prompt",
    ]);
  });

  it("marks the saved preference active", async () => {
    withTerminalApi("cmd");
    renderPane();
    await waitFor(() =>
      expect(segButtonsFor("Windows terminal shell")).toHaveLength(2),
    );

    const active = segButtonsFor("Windows terminal shell").filter((b) =>
      b.classList.contains("active"),
    );
    expect(active.map((b) => b.textContent)).toEqual(["Command Prompt"]);
  });

  it("persists a change and reflects the new selection", async () => {
    withTerminalApi("powershell");
    renderPane();
    await waitFor(() =>
      expect(segButtonsFor("Windows terminal shell")).toHaveLength(2),
    );

    fireEvent.click(segButtonsFor("Windows terminal shell")[1]!);

    await waitFor(() =>
      expect(window.hermesAPI.setTerminalPreference).toHaveBeenCalledWith("cmd"),
    );
    await waitFor(() =>
      expect(
        segButtonsFor("Windows terminal shell")
          .filter((b) => b.classList.contains("active"))
          .map((b) => b.textContent),
      ).toEqual(["Command Prompt"]),
    );
  });

  it("hides the row when the preference bridge is unavailable", async () => {
    // An older main process has no getter: showing a control that cannot save
    // would be worse than showing nothing.
    (window as unknown as { hermesAPI: Record<string, unknown> }).hermesAPI = {
      getGpuStatus: vi.fn().mockResolvedValue({
        preference: "auto",
        bootPreference: "auto",
        reason: "ok",
      }),
      setGpuPreference: vi.fn().mockResolvedValue(true),
      listSystemFonts: vi.fn().mockResolvedValue([]),
      relaunchApp: vi.fn(),
    };
    renderPane();
    await waitFor(() => expect(screen.getByText("Rounded corners")).toBeDefined());
    expect(() => segButtonsFor("Windows terminal shell")).toThrow();
  });
});
