// @vitest-environment jsdom
//
// Ctrl+F routing. The bug: pressing Ctrl+F with the caret in the FILE editor
// focused the app's global search bar (`components/SearchBar.tsx`) instead of
// the editor's own find panel. SearchBar listens on `window`, and its listener
// runs before CodeMirror's scoped keymap can, so it must explicitly yield.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchBar } from "../../../components/SearchBar";

const DOC = "alpha one\nalpha two";

/** The global search bar's input, identified without relying on role. */
function globalInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(".search-bar input");
  if (!el) throw new Error("global SearchBar input not found");
  return el;
}

/** An editor wired the way FileViewer wires its own (search + Mod-f keymap). */
function mountEditor(): { view: EditorView; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: DOC,
      extensions: [search({ top: true }), keymap.of(searchKeymap)],
    }),
  });
  return { view, host };
}

/** Dispatch Ctrl+F the way a browser delivers it to the focused element. */
function pressCtrlF(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("Ctrl+F with the file editor focused", () => {
  it("does not hijack focus away from the editor", () => {
    const { view, host } = mountEditor();
    try {
      render(<SearchBar initialFolders={[]} sessionId={null} />);
      // Focus inside the CodeMirror content, as a user typing would be.
      view.focus();
      view.dispatch({ selection: { anchor: 2 } });

      const event = pressCtrlF(view.contentDOM);

      // SearchBar must not have stolen focus: the caret stays in the editor,
      // so CodeMirror's own Mod-f handler is free to open its find panel.
      // (defaultPrevented is not asserted here: CodeMirror itself calls
      // preventDefault when it handles the key.)
      expect(document.activeElement).not.toBe(globalInput());
      expect(event.key).toBe("f");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("still focuses the global search bar when the editor is not focused", () => {
    const { view, host } = mountEditor();
    try {
      render(<SearchBar initialFolders={[]} sessionId={null} />);
      // Focus something outside any .cm-editor.
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();

      pressCtrlF(window);

      expect(document.activeElement).toBe(globalInput());
      outside.remove();
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("yields while an editor search panel is open", () => {
    const { view, host } = mountEditor();
    try {
      render(<SearchBar initialFolders={[]} sessionId={null} />);
      // Simulate the panel being open (its input can sit outside .cm-editor).
      const panel = document.createElement("div");
      panel.className = "cm-panel cm-search";
      document.body.appendChild(panel);

      const event = pressCtrlF(window);

      expect(event.defaultPrevented).toBe(false);
      panel.remove();
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
