import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Globe,
  MousePointerClick,
  Plus,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import {
  BrowserTabView,
  type BrowserTabNavState,
  type BrowserTabViewHandle,
} from "./BrowserTabView";
import {
  BLANK_URL,
  activeTab,
  closeTab,
  loadTabs,
  normaliseUrlInput,
  openTab,
  saveTabs,
  selectTab,
  tabLabel,
  updateTab,
  type BrowserTabsState,
} from "./browserTabs";
import {
  INSPECTOR_CLEANUP_SCRIPT,
  INSPECTOR_SCRIPT,
  INSPECT_CANCELLED,
  INSPECT_RESULT_PREFIX,
} from "./webPreviewInspector";

interface WebPreviewPanelProps {
  initialUrl: string;
  onClose: () => void;
  onInspectElement?: (payload: {
    tagName: string;
    id: string;
    className: string;
    outerHTML: string;
  }) => void;
  /**
   * Fill the parent instead of sizing itself.
   *
   * Set when hosted in a floating dialog, which owns width/height. Standalone
   * (the default) keeps the original inline-pane behaviour and resize handle.
   */
  embedded?: boolean;
}

const MIN_PANEL_WIDTH = 320;
const WIDTH_STORAGE_KEY = "hermes:webPreviewWidth";
const maxPanelWidth = (): number =>
  Math.max(MIN_PANEL_WIDTH, window.innerWidth - 360);

/** Per-tab navigation state and its ref to the webview. */
interface TabRuntime {
  nav: BrowserTabNavState;
  view: BrowserTabViewHandle | null;
}

const EMPTY_NAV: BrowserTabNavState = {
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

/**
 * The built-in browser.
 *
 * MULTI-TAB: every tab is its own live <webview> in its own history, and
 * inactive tabs stay mounted so switching never reloads. Open tabs are
 * persisted, so they come back after an app restart.
 *
 * The panel owns the tab LIST and the shared toolbar; each BrowserTabView owns
 * one webview and its events.
 */
export const WebPreviewPanel = memo(function WebPreviewPanel({
  initialUrl,
  onClose,
  onInspectElement,
  embedded = false,
}: WebPreviewPanelProps): React.JSX.Element {
  const { t } = useI18n();

  const [state, setState] = useState<BrowserTabsState>(() => {
    const restored = loadTabs();
    const url = normaliseUrlInput(initialUrl);
    if (!url || url === BLANK_URL) return restored;

    // Already open: just focus it. Reopening the panel with the same link must
    // not create a duplicate tab every time.
    const existing = restored.tabs.find((tab) => tab.url === url);
    if (existing) return selectTab(restored, existing.id);

    // Nothing was persisted, so `loadTabs` handed back a single BLANK tab.
    // Replace it rather than appending: a fresh panel should show one tab with
    // the requested page, not a blank tab plus the page.
    const isPristine =
      restored.tabs.length === 1 && restored.tabs[0].url === BLANK_URL;
    if (isPristine) {
      return { tabs: [{ ...restored.tabs[0], url }], activeId: restored.tabs[0].id };
    }

    // Real restored tabs exist and this URL is new: add it alongside them.
    return openTab(restored, url);
  });

  const [address, setAddress] = useState(() => activeTab(state)?.url ?? "");
  const [isInspecting, setIsInspecting] = useState(false);

  // Resizable width, for the standalone (non-embedded) case.
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH ? saved : 480;
  });
  const [isResizing, setIsResizing] = useState(false);

  const current = activeTab(state);
  const currentId = current?.id ?? "";

  // Per-tab runtime (nav state + webview handle), kept OUT of the tab list
  // because these are not persisted and change on every load event.
  const runtimeRef = useRef<Map<string, TabRuntime>>(new Map());
  const [navVersion, setNavVersion] = useState(0);

  const navFor = useCallback((id: string): BrowserTabNavState => {
    return runtimeRef.current.get(id)?.nav ?? EMPTY_NAV;
  }, []);

  const onNavStateChange = useCallback(
    (tabId: string, nav: BrowserTabNavState): void => {
      const existing = runtimeRef.current.get(tabId);
      runtimeRef.current.set(tabId, {
        nav,
        view: existing?.view ?? null,
      });
      // Bump a counter so the toolbar re-reads the ACTIVE tab's state. Only the
      // active tab's changes matter, so a background tab's load events do not
      // re-render the strip needlessly.
      if (tabId === currentId) setNavVersion((v) => v + 1);
    },
    [currentId],
  );

  const onNavigated = useCallback(
    (tabId: string, url: string): void => {
      setState((prev) => updateTab(prev, tabId, { url }));
      if (tabId === currentId) setAddress(url);
      setState((prev) => {
        saveTabs(prev);
        return prev;
      });
    },
    [currentId],
  );

  const onTitleChange = useCallback((tabId: string, title: string): void => {
    setState((prev) => {
      const next = updateTab(prev, tabId, { title });
      if (next !== prev) saveTabs(next);
      return next;
    });
  }, []);

  // Persist the tab list on every structural change.
  useEffect(() => {
    saveTabs(state);
  }, [state]);

  // Keep the address bar in step with the active tab when switching.
  useEffect(() => {
    setAddress(current?.url ?? "");
  }, [current?.url, currentId]);

  // Escape leaves inspect mode: without it the overlay swallows page clicks
  // and there is no way back except closing the panel.
  useEffect(() => {
    if (!isInspecting) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setIsInspecting(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isInspecting]);

  // Inject / tear down the inspector in the ACTIVE tab, and drop inspect mode
  // when switching away so the abandoned tab is not left with live listeners.
  useEffect(() => {
    const view = runtimeRef.current.get(currentId)?.view;
    if (!view) return;
    if (isInspecting) {
      view.execute(INSPECTOR_SCRIPT);
    } else {
      view.execute(INSPECTOR_CLEANUP_SCRIPT);
    }
  }, [isInspecting, currentId, navVersion]);

  // Leaving a tab must not leave the abandoned one in inspect mode: its overlay
  // would keep swallowing clicks with no way to turn it off from here.
  const lastActiveRef = useRef(currentId);
  useEffect(() => {
    if (lastActiveRef.current === currentId) return;
    const previous = lastActiveRef.current;
    lastActiveRef.current = currentId;
    if (previous) runtimeRef.current.get(previous)?.view?.execute(
      INSPECTOR_CLEANUP_SCRIPT,
    );
    setIsInspecting(false);
  }, [currentId]);

  // Inspect results arrive as console messages from the page. Each tab owns its
  // own webview, so these are wired in BrowserTabView via `onConsoleMessage`
  // rather than through a global channel.
  const handleConsoleMessage = useCallback(
    (message: string): void => {
      if (message.startsWith(INSPECT_RESULT_PREFIX)) {
        if (!isInspecting) return;
        try {
          onInspectElement?.(
            JSON.parse(message.slice(INSPECT_RESULT_PREFIX.length)),
          );
        } catch {
          /* malformed payload — ignore rather than break the panel */
        }
        setIsInspecting(false);
        return;
      }
      if (message === INSPECT_CANCELLED) setIsInspecting(false);
    },
    [isInspecting, onInspectElement],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const submitAddress = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = normaliseUrlInput(address);
    if (!url || !currentId) return;
    // A blank tab navigates in place; a real page gets the URL applied.
    setState((prev) => updateTab(prev, currentId, { url, title: undefined }));
    // Navigate via the webview's own loadURL, NOT `execute("location = ...")`:
    // executeJavaScript throws until dom-ready, so typing in the address bar on
    // a freshly opened tab crashed with "The WebView must be attached to the
    // DOM...". The handle is feature-checked and queued until the guest is up.
    runtimeRef.current.get(currentId)?.view?.loadURL(url);
    setAddress(url);
  };

  const goBack = (): void => runtimeRef.current.get(currentId)?.view?.back();
  const goForward = (): void =>
    runtimeRef.current.get(currentId)?.view?.forward();
  const reload = (): void => runtimeRef.current.get(currentId)?.view?.reload();

  const addTab = (): void => {
    setState((prev) => {
      const next = openTab(prev, BLANK_URL);
      saveTabs(next);
      return next;
    });
    setIsInspecting(false);
  };

  const closeOne = (id: string, e?: React.MouseEvent): void => {
    e?.stopPropagation();
    setState((prev) => {
      const next = closeTab(prev, id);
      saveTabs(next);
      return next;
    });
    runtimeRef.current.delete(id);
  };

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent): void => {
      // Panel sits on the right edge, so dragging the handle left widens it.
      const delta = startX - ev.clientX;
      nextWidth = Math.min(
        maxPanelWidth(),
        Math.max(MIN_PANEL_WIDTH, startWidth + delta),
      );
      setWidth(nextWidth);
    };
    const onUp = (): void => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
      } catch {
        /* storage unavailable — width is simply not remembered */
      }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const nav = navFor(currentId);
  void navVersion; // re-render trigger for nav changes

  const registerView = useCallback(
    (id: string, handle: BrowserTabViewHandle | null): void => {
      const existing = runtimeRef.current.get(id);
      runtimeRef.current.set(id, {
        nav: existing?.nav ?? EMPTY_NAV,
        view: handle,
      });
    },
    [],
  );

  const tabs = useMemo(() => state.tabs, [state.tabs]);

  return (
    <div
      className={`web-preview-panel${
        embedded ? " web-preview-panel--embedded" : ""
      }`}
      style={embedded ? undefined : { width }}
    >
      {!embedded && (
        <div
          className={`web-preview-resize-handle ${
            isResizing ? "web-preview-resize-handle-active" : ""
          }`}
          onPointerDown={startResize}
          title="Drag to resize"
        />
      )}

      {/* ── Tab strip ────────────────────────────────────────────────────── */}
      <div className="web-preview-tabs" role="tablist" aria-label="Browser tabs">
        <div className="web-preview-tabs-scroll">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === state.activeId}
              tabIndex={0}
              className={`web-preview-tab${
                tab.id === state.activeId ? " is-active" : ""
              }`}
              onClick={() => setState((prev) => selectTab(prev, tab.id))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setState((prev) => selectTab(prev, tab.id));
                }
              }}
              title={tabLabel(tab)}
            >
              <span className="web-preview-tab-label">{tabLabel(tab)}</span>
              {/* Only offer close when closing is possible: a lone tab cannot
                  be closed, and a dead × reads as a bug. */}
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="web-preview-tab-close"
                  onClick={(e) => closeOne(tab.id, e)}
                  aria-label={`Close ${tabLabel(tab)}`}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="web-preview-tab-new"
          onClick={addTab}
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── Toolbar (shared across tabs; acts on the active one) ─────────── */}
      <div className="web-preview-header">
        <button
          type="button"
          className="web-preview-btn"
          onClick={goBack}
          disabled={!nav.canGoBack}
          title={t("common.back") || "Back"}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={goForward}
          disabled={!nav.canGoForward}
          title={t("common.forward") || "Forward"}
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={reload}
          title={t("common.reload") || "Reload"}
        >
          <RotateCw size={16} className={nav.loading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          className={`web-preview-btn ${isInspecting ? "web-preview-btn-active" : ""}`}
          onClick={() => setIsInspecting((prev) => !prev)}
          title="Inspect Element"
        >
          <MousePointerClick size={16} />
        </button>

        <form className="web-preview-address-bar" onSubmit={submitAddress}>
          <Globe size={13} className="web-preview-globe-icon" />
          <input
            type="text"
            className="web-preview-address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search or enter web address..."
            aria-label="Address"
          />
        </form>

        <button
          type="button"
          className="web-preview-btn"
          onClick={() => {
            if (current?.url) void window.hermesAPI.openExternal(current.url);
          }}
          disabled={!current?.url || current.url === BLANK_URL}
          title="Open in system browser"
        >
          <ExternalLink size={15} />
        </button>
        <button
          type="button"
          className="web-preview-btn"
          onClick={onClose}
          title={t("common.close") || "Close"}
        >
          <X size={16} />
        </button>
      </div>

      {/* ── One live webview per tab; inactive ones stay mounted ─────────── */}
      <div className="web-preview-body">
        {tabs.map((tab) => (
          <BrowserTabView
            key={tab.id}
            tab={tab}
            active={tab.id === state.activeId}
            ref={(handle) => registerView(tab.id, handle)}
            onNavigated={onNavigated}
            onTitleChange={onTitleChange}
            onNavStateChange={onNavStateChange}
            onConsoleMessage={(tabId, message) => {
              // Only the ACTIVE tab's inspect results matter; a background tab
              // cannot be the one the user is inspecting.
              if (tabId !== currentId) return;
              handleConsoleMessage(message);
            }}
          />
        ))}
      </div>
    </div>
  );
});
