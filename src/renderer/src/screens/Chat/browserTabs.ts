/**
 * Tab state for the built-in browser.
 *
 * The panel renders ONE `<webview>` per tab and keeps every tab mounted, so a
 * background tab keeps its page, scroll position and history — clicking a tab
 * switches visibility rather than reloading. That is the Chrome behaviour; a
 * single reused webview would reload on every switch and lose form state.
 *
 * State lives here rather than in the component because it is pure list
 * manipulation and is worth testing on its own (closing the active tab, reusing
 * a blank tab, deduping, and the persistence round-trip).
 */

export interface BrowserTab {
  id: string;
  url: string;
  /** Last committed page title, for the tab label. Falls back to the host. */
  title?: string;
}

export interface BrowserTabsState {
  tabs: BrowserTab[];
  activeId: string;
}

export const BROWSER_TABS_KEY = "hermes.webPreview.tabs";

/** A blank tab's URL. Electron shows about:blank until a real page loads. */
export const BLANK_URL = "about:blank";

let seq = 0;
/** Monotonic id. Not a URL or an index: tabs are reordered and closed. */
export function newTabId(): string {
  seq += 1;
  return `tab-${Date.now().toString(36)}-${seq}`;
}

export function createTab(url = BLANK_URL): BrowserTab {
  return { id: newTabId(), url };
}

export function initialTabsState(url?: string): BrowserTabsState {
  const tab = createTab(url && url.trim() ? url : BLANK_URL);
  return { tabs: [tab], activeId: tab.id };
}

/**
 * The label shown on a tab.
 *
 * Prefers the page title, then the host, then the raw URL. A blank tab shows
 * "New tab" rather than "about:blank", which is what a user expects.
 */
export function tabLabel(tab: BrowserTab): string {
  const title = tab.title?.trim();
  if (title) return title;
  if (!tab.url || tab.url === BLANK_URL) return "New tab";
  try {
    const u = new URL(tab.url);
    return u.host || u.protocol.replace(":", "") || tab.url;
  } catch {
    return tab.url;
  }
}

/**
 * The URL a home/new tab should open.
 *
 * `about:blank` is not a useful "home", so an empty URL is returned as-is and
 * the caller decides to show the blank state rather than navigating.
 */
export function normaliseUrlInput(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value === BLANK_URL) return BLANK_URL;
  // Local dev hosts are checked BEFORE the scheme test: `localhost:3000` looks
  // like it has a scheme ("localhost:") and would otherwise be returned as-is,
  // producing an URL the webview cannot load.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(value)) {
    return `http://${value}`;
  }
  // A leading scheme (http:, https:, file:, data:, about:…) is respected.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  // A bare word with no dot is a search, not a host.
  if (!value.includes(".") && !value.includes("/")) {
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }
  return `https://${value}`;
}

/** Open a URL in a new tab and make it active. */
export function openTab(
  state: BrowserTabsState,
  url: string,
): BrowserTabsState {
  const tab = createTab(url || BLANK_URL);
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

/**
 * Close a tab.
 *
 * When the ACTIVE tab closes, focus moves to the neighbour on the right, or the
 * left when it was last — the same rule Chrome uses, so the user keeps their
 * place. Closing the only tab is refused: an empty tab strip has no way back.
 */
export function closeTab(state: BrowserTabsState, id: string): BrowserTabsState {
  if (state.tabs.length <= 1) return state;
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;

  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };

  const nextIndex = Math.min(index, tabs.length - 1);
  return { tabs, activeId: tabs[nextIndex].id };
}

export function selectTab(
  state: BrowserTabsState,
  id: string,
): BrowserTabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

export function activeTab(state: BrowserTabsState): BrowserTab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null;
}

/** Record a tab's committed URL/title without disturbing the others. */
export function updateTab(
  state: BrowserTabsState,
  id: string,
  patch: Partial<Pick<BrowserTab, "url" | "title">>,
): BrowserTabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...patch };
    if (next.url === t.url && next.title === t.title) return t;
    changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

/** Persist the tabs so they survive an app restart. */
export function saveTabs(state: BrowserTabsState): void {
  try {
    localStorage.setItem(BROWSER_TABS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — tabs simply are not restored */
  }
}

/**
 * Restore persisted tabs.
 *
 * Anything malformed is DISCARDED rather than throwing: a corrupt value must
 * not prevent the browser from opening. Blank tabs are dropped on restore
 * (restoring an empty tab is noise), and if nothing survives, a single blank
 * tab is returned so the panel always has something to show.
 */
export function loadTabs(): BrowserTabsState {
  try {
    const raw = localStorage.getItem(BROWSER_TABS_KEY);
    if (!raw) return initialTabsState();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return initialTabsState();

    const candidate = parsed as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(candidate.tabs)) return initialTabsState();

    const tabs: BrowserTab[] = [];
    for (const item of candidate.tabs) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { id?: unknown; url?: unknown; title?: unknown };
      if (typeof rec.url !== "string") continue;
      if (!rec.url || rec.url === BLANK_URL) continue; // blank tabs are noise
      tabs.push({
        id: typeof rec.id === "string" && rec.id ? rec.id : newTabId(),
        url: rec.url,
        ...(typeof rec.title === "string" ? { title: rec.title } : {}),
      });
    }
    if (tabs.length === 0) return initialTabsState();

    const wanted =
      typeof candidate.activeId === "string" ? candidate.activeId : "";
    const activeId = tabs.some((t) => t.id === wanted) ? wanted : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return initialTabsState();
  }
}
