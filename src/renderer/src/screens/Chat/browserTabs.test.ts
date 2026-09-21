import { beforeEach, describe, expect, it } from "vitest";
import {
  BLANK_URL,
  BROWSER_TABS_KEY,
  activeTab,
  closeTab,
  createTab,
  initialTabsState,
  loadTabs,
  normaliseUrlInput,
  openTab,
  saveTabs,
  selectTab,
  tabLabel,
  updateTab,
  type BrowserTabsState,
} from "./browserTabs";

beforeEach(() => {
  localStorage.clear();
});

/** A deterministic 3-tab state for the list operations. */
function three(): BrowserTabsState {
  return {
    tabs: [
      { id: "a", url: "https://one.test" },
      { id: "b", url: "https://two.test" },
      { id: "c", url: "https://three.test" },
    ],
    activeId: "b",
  };
}

describe("opening tabs", () => {
  it("starts with a single blank tab", () => {
    const s = initialTabsState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].url).toBe(BLANK_URL);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("opens the requested url as the active tab", () => {
    const s = openTab(initialTabsState(), "https://example.test");
    expect(s.tabs).toHaveLength(2);
    expect(activeTab(s)?.url).toBe("https://example.test");
  });

  it("appends new tabs to the end, like a browser", () => {
    const s = openTab(three(), "https://four.test");
    expect(s.tabs.map((t) => t.url)).toEqual([
      "https://one.test",
      "https://two.test",
      "https://three.test",
      "https://four.test",
    ]);
  });

  it("uses a blank url when none is given", () => {
    const s = openTab(three(), "");
    expect(activeTab(s)?.url).toBe(BLANK_URL);
  });

  it("gives every tab a distinct id", () => {
    let s = initialTabsState();
    s = openTab(s, "https://a.test");
    s = openTab(s, "https://b.test");
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(s.tabs.length);
  });
});

describe("closing tabs", () => {
  it("refuses to close the last remaining tab", () => {
    // An empty strip would have no way back to a usable state.
    const s = initialTabsState();
    const after = closeTab(s, s.tabs[0].id);
    expect(after.tabs).toHaveLength(1);
  });

  it("keeps the active tab when a background tab closes", () => {
    const after = closeTab(three(), "a");
    expect(after.activeId).toBe("b");
    expect(after.tabs.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("activates the RIGHT neighbour when the active tab closes", () => {
    // Chrome's rule: focus moves right, so the user keeps their place.
    const after = closeTab(three(), "b");
    expect(after.activeId).toBe("c");
  });

  it("activates the LEFT neighbour when the LAST tab closes", () => {
    const after = closeTab(three(), "c");
    expect(after.activeId).toBe("b");
  });

  it("ignores an unknown id", () => {
    const before = three();
    expect(closeTab(before, "nope")).toBe(before);
  });
});

describe("selecting tabs", () => {
  it("switches the active tab", () => {
    expect(selectTab(three(), "a").activeId).toBe("a");
  });

  it("ignores an unknown id rather than blanking the panel", () => {
    const before = three();
    expect(selectTab(before, "nope")).toBe(before);
  });
});

describe("tab labels", () => {
  it("prefers the page title", () => {
    expect(tabLabel({ id: "a", url: "https://x.test/p", title: "My Page" })).toBe(
      "My Page",
    );
  });

  it("falls back to the host", () => {
    expect(tabLabel({ id: "a", url: "https://docs.example.com/x/y" })).toBe(
      "docs.example.com",
    );
  });

  it("labels a blank tab rather than showing about:blank", () => {
    expect(tabLabel({ id: "a", url: BLANK_URL })).toBe("New tab");
    expect(tabLabel({ id: "a", url: "" })).toBe("New tab");
  });

  it("ignores a whitespace-only title", () => {
    expect(tabLabel({ id: "a", url: "https://x.test", title: "   " })).toBe(
      "x.test",
    );
  });

  it("passes through an unparseable url instead of throwing", () => {
    expect(tabLabel({ id: "a", url: "not a url" })).toBe("not a url");
  });
});

describe("url normalisation", () => {
  it("keeps an explicit scheme", () => {
    expect(normaliseUrlInput("https://a.test")).toBe("https://a.test");
    expect(normaliseUrlInput("http://a.test")).toBe("http://a.test");
    expect(normaliseUrlInput("file:///tmp/x.html")).toBe("file:///tmp/x.html");
  });

  it("prefers http for local dev hosts", () => {
    // A dev server on localhost is almost never https.
    expect(normaliseUrlInput("localhost:3000")).toBe("http://localhost:3000");
    expect(normaliseUrlInput("127.0.0.1:8080/app")).toBe(
      "http://127.0.0.1:8080/app",
    );
  });

  it("adds https for a bare host", () => {
    expect(normaliseUrlInput("example.com")).toBe("https://example.com");
  });

  it("treats a bare word as a search", () => {
    expect(normaliseUrlInput("hermes agent")).toBe(
      "https://www.google.com/search?q=hermes%20agent",
    );
  });

  it("returns empty for empty input so the blank state shows", () => {
    expect(normaliseUrlInput("   ")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseUrlInput("  https://a.test  ")).toBe("https://a.test");
  });
});

describe("updating tabs", () => {
  it("records the url and title", () => {
    const s = updateTab(three(), "a", { url: "https://new.test", title: "New" });
    expect(s.tabs[0]).toMatchObject({ url: "https://new.test", title: "New" });
  });

  it("leaves other tabs untouched", () => {
    const s = updateTab(three(), "a", { url: "https://new.test" });
    expect(s.tabs[1].url).toBe("https://two.test");
  });

  it("returns the SAME object when nothing changed, so React skips a render", () => {
    const before = three();
    expect(updateTab(before, "a", { url: "https://one.test" })).toBe(before);
  });
});

describe("persistence", () => {
  it("round-trips tabs and the active selection", () => {
    saveTabs(three());
    const restored = loadTabs();
    expect(restored.tabs.map((t) => t.url)).toEqual([
      "https://one.test",
      "https://two.test",
      "https://three.test",
    ]);
    expect(restored.activeId).toBe("b");
  });

  it("drops blank tabs on restore, since an empty tab is noise", () => {
    saveTabs({
      tabs: [
        { id: "a", url: BLANK_URL },
        { id: "b", url: "https://keep.test" },
      ],
      activeId: "b",
    });
    const restored = loadTabs();
    expect(restored.tabs.map((t) => t.url)).toEqual(["https://keep.test"]);
  });

  it("falls back to a single blank tab when nothing was saved", () => {
    const restored = loadTabs();
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0].url).toBe(BLANK_URL);
  });

  it("falls back to a single tab when only blanks were saved", () => {
    saveTabs({ tabs: [{ id: "a", url: BLANK_URL }], activeId: "a" });
    expect(loadTabs().tabs).toHaveLength(1);
  });

  it("repairs a stale activeId instead of showing no tab", () => {
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({
        tabs: [{ id: "a", url: "https://x.test" }],
        activeId: "gone",
      }),
    );
    expect(loadTabs().activeId).toBe("a");
  });

  it("discards corrupt data rather than throwing", () => {
    // A bad value must never stop the browser from opening.
    localStorage.setItem(BROWSER_TABS_KEY, "{not json");
    expect(() => loadTabs()).not.toThrow();
    expect(loadTabs().tabs).toHaveLength(1);
  });

  it("discards malformed tab entries and keeps the valid ones", () => {
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({
        tabs: [null, 7, { url: 123 }, { url: "https://ok.test" }],
        activeId: "x",
      }),
    );
    const restored = loadTabs();
    expect(restored.tabs.map((t) => t.url)).toEqual(["https://ok.test"]);
  });

  it("survives localStorage being unavailable", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    expect(() => saveTabs(three())).not.toThrow();
    Storage.prototype.setItem = original;
  });

  it("assigns an id to a restored tab that lost one", () => {
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({ tabs: [{ url: "https://ok.test" }], activeId: "" }),
    );
    const restored = loadTabs();
    expect(restored.tabs[0].id).toBeTruthy();
    expect(restored.activeId).toBe(restored.tabs[0].id);
  });
});

describe("createTab", () => {
  it("defaults to blank", () => {
    expect(createTab().url).toBe(BLANK_URL);
  });
});
