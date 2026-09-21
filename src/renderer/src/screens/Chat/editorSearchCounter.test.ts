// @vitest-environment jsdom
//
// Regression tests for the search counter BADGE. The previous attempt rendered
// the counter in app chrome (a status bar) and the user never saw it, so this
// asserts the counter lands inside CodeMirror's own search panel — and that it
// survives the panel being rebuilt on each query change.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search, openSearchPanel } from "@codemirror/search";
import { describe, expect, it, vi } from "vitest";
import { searchHighlights } from "./editorSearch";

const DOC = "alpha one\nalpha two\nalpha three\nalpha fourth";

function mount(): { view: EditorView; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: DOC,
      extensions: [search({ top: true }), searchHighlights(vi.fn())],
    }),
  });
  return { view, host };
}

/** Type into the real search panel input, the way a user does. */
function type(host: HTMLElement, value: string): void {
  const input = host.querySelector<HTMLInputElement>(
    ".cm-panel.cm-search input[name=search]",
  );
  if (!input) throw new Error("search panel input not found");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const badge = (host: HTMLElement): HTMLElement | null =>
  host.querySelector(".cm-search-count-badge");

describe("search count badge", () => {
  it("appears inside the search panel, next to the query input", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "alpha");

      const el = badge(host);
      expect(el).not.toBeNull();
      // It must live in the panel row, not elsewhere in the app chrome.
      expect(el!.closest(".cm-panel.cm-search")).not.toBeNull();
      // And sit immediately after the query input, VS Code style.
      const input = host.querySelector("input[name=search]")!;
      expect(input.nextElementSibling).toBe(el);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("shows the total match count for the whole document", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "alpha");
      expect(badge(host)!.textContent).toBe("1/4");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("reports 0/0 when nothing matches", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "zzzz");
      expect(badge(host)!.textContent).toBe("0/0");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("keeps updating when the query changes again (panel rebuild)", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "alpha");
      expect(badge(host)!.textContent).toBe("1/4");
      // A second query replaces the panel DOM; the badge must come back.
      type(host, "one");
      expect(badge(host)!.textContent).toBe("1/1");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("advances the active index when the selection moves to another match", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "alpha");
      // Move the caret onto the second occurrence.
      const second = DOC.indexOf("alpha", DOC.indexOf("alpha") + 1);
      view.dispatch({ selection: { anchor: second, head: second + 5 } });
      expect(badge(host)!.textContent).toBe("2/4");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("exposes the count to assistive tech", () => {
    const { view, host } = mount();
    try {
      openSearchPanel(view);
      type(host, "alpha");
      const el = badge(host)!;
      expect(el.getAttribute("role")).toBe("status");
      expect(el.getAttribute("aria-live")).toBe("polite");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
