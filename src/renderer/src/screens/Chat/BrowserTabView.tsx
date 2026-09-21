import { memo, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { BrowserTab } from "./browserTabs";

/**
 * Electron's <webview> element, narrowed to the members used here.
 *
 * Typed locally rather than via `any`: the Electron DOM types are not part of
 * the web tsconfig, and this is the entire surface we touch.
 */
export interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<unknown>;
  stop(): void;
  executeJavaScript(script: string): Promise<unknown>;
}

export interface BrowserTabNavState {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/**
 * Whether this tab's guest process is attached and can accept calls.
 *
 * THE BUG THIS EXISTS FOR: `<webview>` exposes `reload`, `executeJavaScript`,
 * `goBack` etc. as ordinary functions IMMEDIATELY, so a `typeof === "function"`
 * check passes while the guest is not yet attached — and the call then throws
 * "The WebView must be attached to the DOM and the dom-ready event emitted
 * before this method can be called." Electron offers no `isConnected()` /
 * `isDestroyed()` on the element, so readiness must be tracked from the
 * `dom-ready` event: guest methods are only safe after it fires.
 */
export function canUseGuest(ready: boolean): boolean {
  return ready;
}

export interface BrowserTabViewHandle {
  back(): void;
  forward(): void;
  reload(): void;
  /**
   * Navigate this tab to `url`. Queued until the guest is ready, so calling it
   * on a freshly opened tab is safe.
   */
  loadURL(url: string): void;
  /** Inject a script into THIS tab (element inspector). */
  execute(script: string): void;
  /** Focus the webview so page keyboard input works after a switch. */
  focus(): void;
  /** The underlying element, for the panel's inspector bookkeeping. */
  element(): WebviewElement | null;
  /**
   * Whether the guest has attached (dom-ready fired).
   *
   * Exposed for tests and diagnostics: callers cannot infer readiness from the
   * element, because `<webview>` has no isConnected()/isDestroyed().
   */
  isReady(): boolean;
}

/**
 * One browser tab: a single <webview> plus its per-tab navigation state.
 *
 * A tab is its own component so each keeps a SEPARATE history, session view and
 * scroll position. Sharing one webview across tabs would reload on every switch
 * and lose form state — the thing real tabs exist to avoid.
 *
 * Inactive tabs stay MOUNTED and are hidden with CSS: unmounting destroys the
 * page, so switching back would reload it.
 */
export const BrowserTabView = memo(function BrowserTabView({
  tab,
  active,
  ref,
  onNavigated,
  onTitleChange,
  onNavStateChange,
  onConsoleMessage,
}: {
  tab: BrowserTab;
  /** Whether this tab is the visible one. Inactive tabs stay mounted. */
  active: boolean;
  ref?: React.Ref<BrowserTabViewHandle>;
  onNavigated: (tabId: string, url: string) => void;
  onTitleChange: (tabId: string, title: string) => void;
  onNavStateChange: (tabId: string, state: BrowserTabNavState) => void;
  /** Page console output, used to receive element-inspector results. */
  onConsoleMessage?: (tabId: string, message: string) => void;
}): React.JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null);
  /**
   * True once the guest has emitted `dom-ready`.
   *
   * A REF, not state: the toolbar reads it inside callbacks, and re-rendering
   * on attach is pointless (nothing visible changes). A ref is also always
   * current at call time, unlike a captured state value.
   */
  const guestReadyRef = useRef(false);
  /** Queued guest calls made before dom-ready, replayed once it fires. */
  const pendingRef = useRef<Array<(wv: WebviewElement) => void>>([]);

  /**
   * Run `fn` against the webview, but ONLY once the guest is attached.
   *
   * Calls made too early are QUEUED and replayed on dom-ready rather than
   * dropped: opening the panel and immediately hitting reload would otherwise
   * silently do nothing.
   */
  const withGuest = useCallback((fn: (wv: WebviewElement) => void): void => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (!guestReadyRef.current) {
      pendingRef.current.push(fn);
      return;
    }
    try {
      fn(wv);
    } catch (err) {
      // The guest can die between the readiness check and the call (crash,
      // navigation). Never let a toolbar click throw into React's render path.
      console.warn("[web-preview] guest call failed:", err);
    }
  }, []);

  // Callbacks are held in refs so the event effect never needs to re-subscribe:
  // re-running it would detach and re-attach listeners on every parent render.
  const navigatedRef = useRef(onNavigated);
  const titleRef = useRef(onTitleChange);
  const navStateRef = useRef(onNavStateChange);
  const consoleRef = useRef(onConsoleMessage);
  useEffect(() => {
    navigatedRef.current = onNavigated;
    titleRef.current = onTitleChange;
    navStateRef.current = onNavStateChange;
    consoleRef.current = onConsoleMessage;
  }, [onNavigated, onTitleChange, onNavStateChange, onConsoleMessage]);

  const emitNavState = useRef((): void => undefined);

  useImperativeHandle(
    ref,
    () => ({
      back: () =>
        withGuest((wv) => {
          if (wv.canGoBack()) wv.goBack();
        }),
      forward: () =>
        withGuest((wv) => {
          if (wv.canGoForward()) wv.goForward();
        }),
      reload: () => withGuest((wv) => wv.reload()),
      /**
       * Navigate the tab. Uses the guest's own loadURL rather than executing
       * `location = ...`, because executeJavaScript throws before dom-ready —
       * which is exactly what broke typing in the address bar on a new tab.
       */
      loadURL: (url: string) =>
        withGuest((wv) => {
          void wv.loadURL(url).catch(() => undefined);
        }),
      execute: (script: string) =>
        withGuest((wv) => {
          void wv.executeJavaScript(script).catch(() => undefined);
        }),
      focus: () => withGuest((wv) => wv.focus()),
      element: () => webviewRef.current,
      /** For tests/diagnostics: has the guest attached yet? */
      isReady: () => guestReadyRef.current,
    }),
    [withGuest],
  );

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const id = tab.id;

    const sync = (): void => {
      navStateRef.current(id, {
        canGoBack: safeCanGoBack(wv),
        canGoForward: safeCanGoForward(wv),
        loading: false,
      });
    };
    emitNavState.current = sync;

    /**
     * The guest is attached: mark it ready and replay anything that was queued
     * while it was still attaching (an early reload/back click, or the
     * inspector script).
     */
    const onDomReady = (): void => {
      guestReadyRef.current = true;
      const queued = pendingRef.current;
      pendingRef.current = [];
      for (const fn of queued) {
        try {
          fn(wv);
        } catch (err) {
          console.warn("[web-preview] queued guest call failed:", err);
        }
      }
      sync();
    };

    // A crashed guest is no longer usable: clear readiness so later calls are
    // queued again instead of throwing, and reload to recover the tab.
    const onCrashed = (): void => {
      guestReadyRef.current = false;
    };

    const onStart = (): void =>
      navStateRef.current(id, {
        canGoBack: false,
        canGoForward: false,
        loading: true,
      });

    const onNavigate = (e: Event): void => {
      const url = (e as unknown as { url?: string }).url;
      if (url) navigatedRef.current(id, url);
      sync();
    };

    const onTitle = (e: Event): void => {
      const title = (e as unknown as { title?: string }).title;
      if (title) titleRef.current(id, title);
    };

    // Console output carries the inspector's results; forward it so the panel
    // can decide (it owns the inspect-mode state).
    const onConsole = (e: Event): void => {
      const message = (e as unknown as { message?: string }).message;
      if (message) consoleRef.current?.(id, message);
    };

    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", sync);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);
    wv.addEventListener("page-title-updated", onTitle);
    wv.addEventListener("console-message", onConsole);
    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("crashed", onCrashed);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", sync);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("page-title-updated", onTitle);
      wv.removeEventListener("console-message", onConsole);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("crashed", onCrashed);
      // The element is going away: drop queued calls rather than leaking them
      // (they would fire against a detached guest if the effect re-ran).
      guestReadyRef.current = false;
      pendingRef.current = [];
    };
    // Only the tab identity matters: the callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  return (
    <div
      className={`web-preview-tab-view${active ? " is-active" : ""}`}
      // Hidden, NOT unmounted: the page and its session must survive a switch.
      hidden={!active}
      aria-hidden={!active}
    >
      <webview
        ref={webviewRef as unknown as React.Ref<WebviewElement>}
        src={tab.url}
        {...({
          // A real Electron <webview> attribute, forwarded to
          // will-attach-webview in main. SHARED across tabs so they share one
          // session (cookies/logins), exactly like tabs in one browser window.
          partition: "web-preview",
        } as Record<string, unknown>)}
        className="web-preview-webview"
      />
    </div>
  );
});

/** canGoBack/canGoForward throw before dom-ready; treat that as "no". */
function safeCanGoBack(wv: WebviewElement): boolean {
  try {
    return wv.canGoBack();
  } catch {
    return false;
  }
}
function safeCanGoForward(wv: WebviewElement): boolean {
  try {
    return wv.canGoForward();
  } catch {
    return false;
  }
}
