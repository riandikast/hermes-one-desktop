import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";

it("registers only a confirmed selected path, maps its span while editing, saves it without changing prose", async () => {
  const path = "C:/project/code.ts",
    content = `Read ${path}. Prose ${path}`;
  let diskContent = content;
  let diskRefs: { start: number; end: number; text: string; path: string }[] =
    [];
  // jsdom has no text layout; selection geometry is verified in Chromium.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  Object.assign(window, {
    hermesAPI: {
      listKnowledgeBundles: vi.fn(async () => [
        {
          name: "guide",
          path: "C:/k/guide",
          files: [
            {
              name: "note.md",
              relativePath: "guide/note.md",
              path: "C:/k/guide/note.md",
              size: content.length,
            },
          ],
        },
      ]),
      readKnowledgeFile: vi.fn(async () => diskContent),
      getKnowledgeDocumentReferences: vi.fn(async () => diskRefs),
      saveKnowledgeDocument: vi.fn(async (_key, text, refs) => {
        diskContent = text;
        diskRefs = refs;
        return true;
      }),
    },
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<KnowledgeScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "guide 1 file" }));
  fireEvent.click(await screen.findByRole("button", { name: /note.md/ }));
  await waitFor(() =>
    expect(document.querySelector(".cm-editor")).toBeTruthy(),
  );
  const view = EditorView.findFromDOM(
    document.querySelector(".cm-editor")! as HTMLElement,
  )!;
  act(() => view.dispatch({ selection: { anchor: 5, head: 5 + path.length } }));
  fireEvent.click(
    screen.getByRole("button", { name: "Register selected path" }),
  );
  expect(window.confirm).toHaveBeenCalledWith(
    `Register this exact path for portable export?\n${path}`,
  );
  act(() => view.dispatch({ changes: { from: 0, insert: "Prefix " } }));
  const reads = vi.mocked(window.hermesAPI.readKnowledgeFile).mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(window.hermesAPI.readKnowledgeFile).toHaveBeenCalledTimes(reads);
  expect(view.state.doc.toString()).toBe("Prefix " + content);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(window.hermesAPI.saveKnowledgeDocument).toHaveBeenCalledOnce(),
  );
  expect(window.hermesAPI.saveKnowledgeDocument).toHaveBeenCalledWith(
    "guide/note.md",
    "Prefix " + content,
    [{ start: 12, end: 12 + path.length, text: path, path }],
    [],
  );
  window.dispatchEvent(new Event("focus"));
  await act(async () => {});
  expect(view.state.doc.toString()).toBe("Prefix " + content);
});
