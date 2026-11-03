import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../ThemeProvider";
import ThemeEditor from "./ThemeEditor";
import {
  loadCustomThemes,
  saveCustomThemes,
  seedCustomFrom,
  themeVars,
} from "../../theme/themeEditor";

function Harness({ id = "dracula" }: { id?: string }): React.JSX.Element {
  return (
    <ThemeProvider>
      <ThemeEditor editingId={id} onEdit={() => {}} onClose={() => {}} />
    </ThemeProvider>
  );
}

function changeColor(variable: string, value: string): void {
  const input = screen
    .getAllByText(variable)[0]
    .closest("label")!
    .querySelector<HTMLInputElement>(".theme-editor-var-input")!;
  fireEvent.change(input, { target: { value } });
}

function save(): void {
  fireEvent.click(screen.getByText("Save theme"));
}

describe("ThemeEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = "";
  });

  it("renders variable fields for a built-in", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Theme name")).toBeTruthy();
    expect(screen.getAllByText("--bg-primary").length).toBeGreaterThan(0);
  });

  it("saves an override into the injected style tag", async () => {
    render(<Harness />);
    const accentLabel = screen.getAllByText("--accent")[0].closest("label")!;
    const valueInput = accentLabel.querySelector(
      ".theme-editor-var-input",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(valueInput, { target: { value: "#123456" } });
      fireEvent.click(screen.getByText("Save theme"));
    });
    const style = document.getElementById("hermes-custom-themes-style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("--accent: #123456");
  });

  // @lat: [[appearance-themes#Theme persistence#Repeated built-in saves]]
  it("preserves earlier overrides on subsequent saves and reloads", () => {
    const view = render(<Harness />);
    changeColor("--accent", "#123456");
    save();
    changeColor("--text-primary", "#abcdef");
    save();
    expect(loadCustomThemes().dracula.vars).toEqual({
      "--accent": "#123456",
      "--text-primary": "#abcdef",
    });
    expect(themeVars("nord", loadCustomThemes())).toEqual(
      themeVars("nord", {}),
    );
    view.unmount();
    render(<Harness />);
    expect(
      document.getElementById("hermes-custom-themes-style")!.textContent,
    ).toContain("--accent: #123456");
    changeColor("--accent", themeVars("dracula", {})!["--accent"]);
    save();
    expect(loadCustomThemes().dracula.vars).toEqual({
      "--text-primary": "#abcdef",
    });
    changeColor("--text-primary", themeVars("dracula", {})!["--text-primary"]);
    save();
    expect(loadCustomThemes().dracula).toBeUndefined();
  });

  // @lat: [[appearance-themes#Theme persistence#Custom palette saves]]
  it("preserves the complete copied palette on edits and rename", () => {
    const copy = seedCustomFrom("dracula", "my-copy", "My Copy", {});
    saveCustomThemes({ "my-copy": copy });
    const view = render(<Harness id="my-copy" />);
    changeColor("--accent", "#123456");
    save();
    fireEvent.change(screen.getByLabelText("Theme name"), {
      target: { value: "Renamed Copy" },
    });
    save();
    expect(loadCustomThemes()["my-copy"]).toEqual({
      ...copy,
      name: "Renamed Copy",
      vars: { ...copy.vars, "--accent": "#123456" },
    });
    view.unmount();
    render(<Harness id="my-copy" />);
    expect(
      (screen.getByLabelText("Theme name") as HTMLInputElement).value,
    ).toBe("Renamed Copy");
    expect(
      document.getElementById("hermes-custom-themes-style")!.textContent,
    ).toContain(`--bg-primary: ${copy.vars["--bg-primary"]}`);
    expect(screen.queryByText("Reset")).toBeNull();
  });

  // @lat: [[appearance-themes#Theme persistence#Per-theme reset]]
  it("resets only the edited built-in to bundled defaults", () => {
    const other = seedCustomFrom("light", "other", "Other", {});
    saveCustomThemes({
      dracula: {
        name: "Dracula",
        appearance: "dark",
        vars: { "--accent": "#123456" },
      },
      other,
    });
    render(<Harness />);
    fireEvent.click(screen.getByText("Reset"));
    expect(loadCustomThemes()).toEqual({ other });
    expect(themeVars("dracula", loadCustomThemes())).toEqual(
      themeVars("dracula", {}),
    );
    const css = document.getElementById(
      "hermes-custom-themes-style",
    )!.textContent!;
    expect(css).not.toContain('[data-theme="dracula"]');
    expect(css).toContain('[data-theme="other"]');
  });
});
