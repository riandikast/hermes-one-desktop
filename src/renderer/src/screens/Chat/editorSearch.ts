import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { getSearchQuery } from "@codemirror/search";

/**
 * VS Code-style search feedback for the CodeMirror editors in this app.
 *
 * Two gaps in the stock `@codemirror/search` panel:
 *
 *  1. `search()` marks only the ACTIVE match (`cm-searchMatch-selected`) and the
 *     matches on the cursor's line. Every other occurrence is left unmarked, so
 *     a search looks like it found a single hit — the user asked for the
 *     "highlight all occurrences" behaviour VS Code has.
 *  2. The panel shows no match counter. VS Code's "2/10" is genuinely useful:
 *     how many hits exist, and which one you are on.
 *
 * Both are built as a decoration layer plus a counter callback, NOT by
 * rewriting the panel's DOM: CodeMirror rebuilds the search panel on every
 * query change, so injected DOM would be discarded and would fight CM.
 */

/** Match count and active position, published for the counter UI. */
export interface SearchMatchInfo {
  /** 1-based position of the active match; 0 when none is active. */
  index: number;
  /** Total matches in the document. */
  total: number;
}

export const EMPTY_MATCH_INFO: SearchMatchInfo = { index: 0, total: 0 };

/**
 * A decoration marking EVERY match. The active match keeps CodeMirror's own
 * class so it stays visually distinct; the rest take `cm-searchMatch-all`,
 * which the stylesheet renders as a softer highlight.
 */
const allMatchMark = Decoration.mark({ class: "cm-searchMatch-all" });

/**
 * Upper bound on decorated matches. A one-character query in a large file can
 * match tens of thousands of times; decorating them all costs more than the
 * highlight is worth. The counter still reports the TRUE total separately.
 */
const MAX_HIGHLIGHTED_MATCHES = 5000;

function buildMatchDecorations(state: EditorState): DecorationSet {
  const query = getSearchQuery(state);
  if (!query.search) return Decoration.none;

  const ranges: ReturnType<typeof allMatchMark.range>[] = [];
  const cursor = query.getCursor(state.doc);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const { from, to } = next.value;
    // Zero-width matches (e.g. the `^` anchor) cannot be marked.
    if (to > from) ranges.push(allMatchMark.range(from, to));
    if (ranges.length >= MAX_HIGHLIGHTED_MATCHES) break;
  }
  return Decoration.set(ranges, true);
}

/** Effect carrying a freshly-built highlight layer. */
const setAllMatchDecorations = StateEffect.define<DecorationSet>();

const highlightLayer = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAllMatchDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Total matches for the current query (not capped, unlike the highlights). */
export function countMatches(state: EditorState): number {
  const query = getSearchQuery(state);
  if (!query.search) return 0;
  let total = 0;
  const cursor = query.getCursor(state.doc);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (next.value.to > next.value.from) total += 1;
  }
  return total;
}

/** Which match the selection sits on (1-based), or 0 when it sits on none. */
export function activeMatchIndex(state: EditorState): number {
  const query = getSearchQuery(state);
  if (!query.search) return 0;
  const selection = state.selection.main;
  let index = 0;
  const cursor = query.getCursor(state.doc);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const { from, to } = next.value;
    if (to === from) continue;
    index += 1;
    if (from <= selection.from && to >= selection.to) return index;
  }
  return 0;
}

export function searchMatchInfo(state: EditorState): SearchMatchInfo {
  return { index: activeMatchIndex(state), total: countMatches(state) };
}

/**
 * Detect a search-query change.
 *
 * CodeMirror's search state field is private (not an exported facet), so there
 * is no facet to declare as a decoration dependency. Comparing the derived
 * query across the update is the reliable signal: the panel re-reads its inputs
 * into a new `SearchQuery` on every keystroke, so a differing query means the
 * search moved.
 */
function searchQueryChanged(update: ViewUpdate): boolean {
  const before = getSearchQuery(update.startState);
  const after = getSearchQuery(update.state);
  return (
    before.search !== after.search ||
    before.caseSensitive !== after.caseSensitive ||
    before.regexp !== after.regexp ||
    before.wholeWord !== after.wholeWord ||
    before.literal !== after.literal
  );
}

/**
 * Editor extension: highlight every match and keep a counter callback fed.
 *
 * The triggers mirror CodeMirror's own highlight plugin (query changed, doc
 * changed, selection changed, viewport changed) so the counter cannot drift
 * from what is highlighted.
 */
export function searchHighlights(
  onInfo: (info: SearchMatchInfo) => void,
): Extension {
  let lastKey = "";
  return [
    highlightLayer,
    // Show the counter IN the search panel row, like VS Code. Rendering it in
    // app chrome elsewhere (a status bar) was invisible in practice: the panel
    // is where the user is looking while searching.
    searchCountPanel,
    EditorView.updateListener.of((update) => {
      if (
        !update.docChanged &&
        !update.selectionSet &&
        !update.viewportChanged &&
        !searchQueryChanged(update)
      ) {
        return;
      }
      const decorations = buildMatchDecorations(update.state);
      update.view.dispatch({ effects: setAllMatchDecorations.of(decorations) });

      const info = searchMatchInfo(update.state);
      const key = `${info.index}/${info.total}`;
      if (key !== lastKey) {
        lastKey = key;
        onInfo(info);
      }
      updateCountBadge(update.view, info);
    }),
  ];
}

/**
 * The counter element injected into CodeMirror's search panel.
 *
 * The panel is rebuilt by CodeMirror whenever the query changes, so the badge
 * is re-appended rather than assumed to persist. A module-level WeakMap keeps
 * one badge per editor view without leaking DOM references.
 */
const countBadges = new WeakMap<EditorView, HTMLElement>();

function updateCountBadge(view: EditorView, info: SearchMatchInfo): void {
  const panelInput = view.dom.querySelector(".cm-panel.cm-search input[name=search]");
  if (!panelInput) return; // panel closed
  const row = panelInput.closest(".cm-search") ?? panelInput.parentElement;
  if (!row) return;

  let badge = countBadges.get(view);
  if (!badge || !badge.isConnected) {
    badge = document.createElement("span");
    badge.className = "cm-search-count-badge";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");
    // Sit immediately after the search input, as VS Code does.
    panelInput.insertAdjacentElement("afterend", badge);
    countBadges.set(view, badge);
  }
  const text =
    info.total === 0 ? "0/0" : `${info.index > 0 ? info.index : 1}/${info.total}`;
  if (badge.textContent !== text) badge.textContent = text;
  badge.setAttribute(
    "title",
    info.total === 0
      ? "No matches"
      : `Match ${info.index > 0 ? info.index : 1} of ${info.total}`,
  );
}

/**
 * Re-asserts the counter badge after CodeMirror rebuilds its search panel.
 *
 * A `ViewPlugin` (rather than the update listener) so it also runs on the
 * update where the panel first appears — the badge must exist the moment the
 * panel is open, not only after the next keystroke.
 */
const searchCountPanel: Extension = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      updateCountBadge(view, searchMatchInfo(view.state));
    }
    update(update: ViewUpdate): void {
      // Cheap (a query + a text write), and it recovers the badge whenever
      // CodeMirror replaces the panel row.
      updateCountBadge(update.view, searchMatchInfo(update.state));
    }
  },
);

