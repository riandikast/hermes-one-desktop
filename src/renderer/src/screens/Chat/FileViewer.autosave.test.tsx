import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import appCss from "../../assets/main.css?raw";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  Object.assign(window, {
    hermesAPI: {
      readFile: vi.fn().mockResolvedValue({ content: "hello\n", truncated: false }),
      readImageFile: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
      openFileInEditor: vi.fn(),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("centers the toggle knob in its track on both axes", () => {
  const block = (selector: string): string => {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(appCss);
    if (!match) throw new Error(`Missing CSS block: ${selector}`);
    return match[1];
  };
  const px = (css: string, property: string): number => {
    const match = new RegExp(`(?:^|;)\\s*${property}:\\s*(\\d+)px`).exec(css);
    if (!match) throw new Error(`Missing ${property} in px`);
    return Number(match[1]);
  };
  const track = block(".tools-toggle-track");
  const knob = block(".tools-toggle-track::after");
  const inset = (px(track, "height") - px(knob, "height")) / 2;
  // The knob used to sit at 2px in a 22px track: 1px high and 1px left.
  expect(inset).toBe(3);
  expect(px(knob, "width")).toBe(px(knob, "height"));
  expect(knob).toContain(`top: calc((22px - 16px) / 2)`);
  expect(knob).toContain(`left: calc((22px - 16px) / 2)`);
  // Checked offset keeps equal inset on the right: 40 - 16 - 3 - 18 = 3.
  expect(px(track, "width") - px(knob, "width") - inset - 18).toBe(inset);
  expect(block(".tools-toggle")).toContain("align-items: center");
});

it("starts with auto-save on and hides the manual Save action", async () => {
  render(<FileViewer filePath="/repo/a.ts" active onClose={vi.fn()} />);
  const toggle = await screen.findByRole("checkbox", { name: "Auto-save this file" });
  expect(toggle).toBeChecked();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("turning auto-save off for one file reveals manual Save and Unsaved state", async () => {
  render(<FileViewer filePath="/repo/a.ts" active onClose={vi.fn()} />);
  const toggle = await screen.findByRole("checkbox", { name: "Auto-save this file" });
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(window.hermesAPI.writeFile).not.toHaveBeenCalled();
});

it("keeps the save mode per file", async () => {
  render(
    <>
      <FileViewer filePath="/repo/a.ts" active onClose={vi.fn()} />
      <FileViewer filePath="/repo/b.ts" active={false} onClose={vi.fn()} />
    </>,
  );
  const [first, second] = await screen.findAllByRole("checkbox", {
    name: "Auto-save this file",
  });
  fireEvent.click(first);
  expect(first).not.toBeChecked();
  expect(second).toBeChecked();
});

it("honours the Utils default for newly opened files", async () => {
  localStorage.setItem("hermes.fileEditor.autoSave", "false");
  render(<FileViewer filePath="/repo/b.ts" active onClose={vi.fn()} />);
  const toggle = await screen.findByRole("checkbox", { name: "Auto-save this file" });
  expect(toggle).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
