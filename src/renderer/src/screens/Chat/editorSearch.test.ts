// @vitest-environment jsdom
//
// Exercises the search extension against a REAL CodeMirror instance. Type
// checking cannot tell whether a facet dependency is satisfiable, whether
// search state is readable on the first update, or whether decorations land —
// so these assert on actual EditorState/DecorationSet output.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search, setSearchQuery, SearchQuery } from "@codemirror/search";
import { describe, expect, it, vi } from "vitest";
import {
  activeMatchIndex,
  countMatches,
  searchHighlights,
  searchMatchInfo,
} from "./editorSearch";

const DOC = [
  "const alpha = 1;",
  "const beta = 2;",
  "// alpha again",
  "function alpha() {",
  "  return alpha;",
  "}",
].join("\n");

function makeView(onInfo = vi.fn()): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [search({ top: true }), searchHighlights(onInfo)],
    }),
  });
  return view;
}

/** Drive a query the same way the panel does. */
function setQuery(view: EditorView, query: SearchQuery): void {
  view.dispatch({ effects: setSearchQuery.of(query) });
}

describe("search match counting", () => {
  it("counts every occurrence in the document", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      expect(countMatches(view.state)).toBe(4);
    } finally {
      view.destroy();
    }
  });

  it("is case-insensitive by default and honours caseSensitive", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "ALPHA" }));
      expect(countMatches(view.state)).toBe(4);
      setQuery(view, new SearchQuery({ search: "ALPHA", caseSensitive: true }));
      expect(countMatches(view.state)).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it("reports zero for an empty query or no matches", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "" }));
      expect(countMatches(view.state)).toBe(0);
      setQuery(view, new SearchQuery({ search: "zzzz" }));
      expect(countMatches(view.state)).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it("identifies which match the selection is on", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      // Put the cursor on the 3rd occurrence (inside "// alpha again").
      const third = DOC.indexOf("alpha", DOC.indexOf("alpha", DOC.indexOf("alpha") + 1) + 1);
      view.dispatch({ selection: { anchor: third, head: third + 5 } });
      expect(activeMatchIndex(view.state)).toBe(3);
      expect(searchMatchInfo(view.state)).toEqual({ index: 3, total: 4 });
    } finally {
      view.destroy();
    }
  });

  it("reports index 0 when the selection is not on a match", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      view.dispatch({ selection: { anchor: 0, head: 1 } });
      expect(activeMatchIndex(view.state)).toBe(0);
      // The total is still reported.
      expect(countMatches(view.state)).toBe(4);
    } finally {
      view.destroy();
    }
  });
});

describe("searchHighlights", () => {
  it("publishes match info to the callback as the query changes", () => {
    const onInfo = vi.fn();
    const view = makeView(onInfo);
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      expect(onInfo).toHaveBeenCalled();
      const last = onInfo.mock.calls.at(-1)![0];
      expect(last.total).toBe(4);
    } finally {
      view.destroy();
    }
  });

  it("marks every match, not only the active one", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));

      // Collect the decoration classes present on the rendered lines.
      const classes = [...view.dom.querySelectorAll("span")].map(
        (el) => el.className,
      );
      const allMarks = classes.filter((c) =>
        c.includes("cm-searchMatch-all"),
      ).length;

      // All four occurrences carry the marker. CodeMirror renders only the
      // viewport, but this document is small enough to be fully visible.
      expect(allMarks).toBeGreaterThanOrEqual(4);
    } finally {
      view.destroy();
    }
  });

  it("clears the highlight layer when the query is emptied", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      setQuery(view, new SearchQuery({ search: "" }));

      const classNames = [...view.dom.querySelectorAll("span")]
        .map((el) => el.className)
        .join(" ");
      expect(classNames).not.toContain("cm-searchMatch-all");
    } finally {
      view.destroy();
    }
  });

  it("does not throw when the document changes mid-search", () => {
    const view = makeView();
    try {
      setQuery(view, new SearchQuery({ search: "alpha" }));
      expect(() =>
        view.dispatch({ changes: { from: 0, insert: "const alpha2 = 0;\n" } }),
      ).not.toThrow();
    } finally {
      view.destroy();
    }
  });
});
