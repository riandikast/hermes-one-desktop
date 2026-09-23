import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider } from "../ThemeProvider";
import ThemeEditor from "./ThemeEditor";

function Harness() {
  return (
    <ThemeProvider>
      <ThemeEditor editingId="dracula" onEdit={() => {}} onClose={() => {}} />
    </ThemeProvider>
  );
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
});
