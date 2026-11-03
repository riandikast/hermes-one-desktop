import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";

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
