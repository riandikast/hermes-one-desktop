// @vitest-environment node
//
// The pinned nav list (Tools / Office / Kanban / Schedules / Knowledge /
// Commands) must not remain expanded on the Bots tab.
//
// Reported bug: expanding that menu on the Sessions tab, then switching to
// Bots, left the expanded menu visible — the Bots rail showed through with the
// Sessions nav still open beneath it.
//
// Cause: the toggle rendered unconditionally. `pinnedNavCollapsed` is a
// persisted USER PREFERENCE, so the fix is to DERIVE the rendered state from
// the tab rather than reset the preference (resetting it would make switching
// tabs silently destroy the user's choice).
//
// Layout.tsx needs a large provider tree to render, so this asserts the
// derivation and its contract against the source — the same approach used for
// the terminal's "+" wiring guard.

import { describe, expect, it } from "vitest";
import layoutSource from "./Layout.tsx?raw";

/** The className expression on the pinned-items container. */
function pinnedItemsClassName(): string {
  const marker = 'className={`sidebar-pinned-items';
  const start = layoutSource.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const end = layoutSource.indexOf("`}", start);
  return layoutSource.slice(start, end);
}

describe("pinned nav list visibility vs the Bots tab", () => {
  it("collapses the pinned list when the Bots tab is active", () => {
    const expr = pinnedItemsClassName();
    // The tab must participate in the decision, not just the preference.
    expect(expr).toContain('sidebarTab === "bots"');
    expect(expr).toContain("sidebar-pinned-items--collapsed");
  });

  it("still honours the user's collapse preference on the Sessions tab", () => {
    expect(pinnedItemsClassName()).toContain("pinnedNavCollapsed");
  });

  it("does NOT write the derived state back to storage", () => {
    // A tab switch must not persist a collapse: that would destroy the
    // preference permanently. Only the explicit toggle may write the key.
    const writers = [...layoutSource.matchAll(
      /localStorage\.setItem\(\s*["']hermes\.sidebar\.pinnedCollapsed["'][^)]*\)/g,
    )];
    // Exactly one writer: togglePinnedNavCollapsed.
    expect(writers.length).toBe(1);

    const toggleStart = layoutSource.indexOf("const togglePinnedNavCollapsed");
    const toggleBody = layoutSource.slice(toggleStart, toggleStart + 400);
    expect(writers[0][0]).toBeDefined();
    expect(toggleBody).toContain("hermes.sidebar.pinnedCollapsed");
  });

  it("hides the collapsed list from assistive tech too", () => {
    // display:none alone is fine visually, but aria-hidden makes the intent
    // explicit for screen readers as well.
    const marker = "sidebar-pinned-items--collapsed";
    const region = layoutSource.slice(
      layoutSource.indexOf("aria-hidden={sidebarTab"),
      layoutSource.indexOf("aria-hidden={sidebarTab") + 60,
    );
    expect(layoutSource).toContain(marker);
    expect(region).toContain('sidebarTab === "bots"');
  });
});
