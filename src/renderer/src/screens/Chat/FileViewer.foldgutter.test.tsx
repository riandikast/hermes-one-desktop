import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FileViewer } from "./FileViewer";
import appCss from "../../assets/main.css?raw";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: vi.fn() }),
}));

/**
 * CodeMirror's fold gutter renders literal `›`/`⌄` text. The editor replaces
 * those glyphs with masked chevron icons, keyed on the marker titles the gutter
 * emits. If a CodeMirror upgrade changes either the markup or the titles, the
 * CSS silently stops matching and the text glyphs come back — so assert both
 * halves of that contract.
 */
it("renders fold markers the chevron CSS targets", async () => {
  Object.assign(window, {
    hermesAPI: {
      readFile: vi.fn().mockResolvedValue({
        content: "export function a() {\n  return 1;\n}\n",
        truncated: false,
      }),
      readImageFile: vi.fn().mockResolvedValue(null),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
      openFileInEditor: vi.fn(),
    },
  });

  const { container } = render(
    <FileViewer filePath="/repo/a.ts" active onClose={vi.fn()} />,
  );

  await waitFor(() =>
    expect(container.querySelectorAll(".cm-foldGutter span[title]").length).toBeGreaterThan(0),
  );
  const titles = [...container.querySelectorAll(".cm-foldGutter span[title]")].map(
    (marker) => marker.getAttribute("title"),
  );
  expect(titles).toEqual(expect.arrayContaining(["Fold line", "Unfold line"]));
  expect(appCss).toContain('.cm-foldGutter .cm-gutterElement span[title="Fold line"]');
  expect(appCss).toContain('.cm-foldGutter .cm-gutterElement span[title="Unfold line"]');
  expect(appCss).toContain("mask-image: url(\"data:image/svg+xml,");
});
