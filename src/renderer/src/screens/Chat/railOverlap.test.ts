// @vitest-environment node
//
// The floating rail's popup panels must open to the LEFT of their icon, not
// drop over the icons below.
//
// Reported bug: opening the settings (display-controls) panel covered the rail
// beneath it — including the toggle itself — so the menu could not be closed.
//
// Cause: `top: 38px; right: 0` anchored each panel to the rail's right edge and
// pushed it DOWN over the column of icons. Because the panel overlapped its own
// trigger, the click that would close it landed on the panel instead.
//
// Verified in real Chromium (see scripts/diag-rail-overlap.cjs):
//   buggy -> menuCoversToggleCentre: true   (unclosable)
//   fixed -> menuCoversToggleCentre: false
//
// jsdom has no layout engine, so this asserts the CSS contract from source —
// the same approach used for the other source guards in this codebase.
//
// Read the stylesheet from disk rather than via `?raw`: Vite resolves a
// `.css?raw` import to an EMPTY string (the stylesheet is processed as an
// asset), which silently made every assertion below vacuous.
//
// Node APIs are reached through a require-style import typed inline, because
// the web tsconfig has no node type declarations.
// @ts-expect-error -- node types are intentionally outside this tsconfig
const nodeModule = (await import("node:module")) as unknown as {
  createRequire: (url: string) => (id: string) => {
    readFileSync: (path: string, encoding: string) => string;
  };
};

const rawCss = nodeModule
  .createRequire(import.meta.url)("node:fs")
  .readFileSync("src/renderer/src/assets/main.css", "utf8");

/** Strip comments so brace/declaration parsing sees only real rules. */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block for a selector, in source order. */
function ruleBlocks(selector: string): string[] {
  const re = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "gm",
  );
  return [...css.matchAll(re)].map((m) => m[1]);
}

/** The last-wins declaration for a property across a selector's blocks. */
function effective(selector: string, prop: string): string | null {
  const blocks = ruleBlocks(selector);
  let value: string | null = null;
  for (const block of blocks) {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "m").exec(block);
    if (m) value = m[1].trim();
  }
  return value;
}

describe("floating rail popups open left of the rail", () => {
  const panels = [".chat-display-controls-menu", ".chat-search-bar"];

  for (const sel of panels) {
    it(`${sel} is anchored to the LEFT of its icon`, () => {
      // Anchoring to the left edge of the rail (right: 0) puts the panel over
      // the icons; it must sit outside the rail instead.
      expect(effective(sel, "right")).toBe("calc(100% + 8px)");
    });

    it(`${sel} is not pushed down over the icons below`, () => {
      // `top: 38px` was the vertical offset that placed it over the next icon.
      expect(effective(sel, "top")).toBe("0");
    });

    it(`${sel} is positioned (so the offset actually applies)`, () => {
      expect(effective(sel, "position")).toBe("absolute");
    });

    it(`${sel} does not set right: 0 anywhere`, () => {
      // A single stale duplicate rule silently wins the cascade, which is
      // exactly how this bug survived: two blocks, the later one dropping the
      // panel downward.
      for (const block of ruleBlocks(sel)) {
        const m = /(?:^|;)\s*right\s*:\s*([^;]+)/m.exec(block);
        if (m) expect(m[1].trim()).not.toBe("0");
      }
    });
  }

  it("caps the search panel width on narrow windows", () => {
    // Opening left from a 340px panel needs ~370px; below that it would clip.
    expect(css).toMatch(
      /@media\s*\(max-width:\s*560px\)\s*\{[^}]*\.chat-search-bar\s*\{[^}]*width:\s*min\(340px,\s*calc\(100vw\s*-\s*48px\)\)/s,
    );
  });
});
