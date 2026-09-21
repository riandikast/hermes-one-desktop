import { memo, useEffect, useImperativeHandle, useRef } from "react";
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
  stop(): void;
  executeJavaScript(script: string): Promise<unknown>;
}

export interface BrowserTabNavState {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserTabViewHandle {
  back(): void;
  forward(): void;
  reload(): void;
  /** Inject a script into THIS tab (element inspector). */
  execute(script: string): void;
  /** Focus the webview so page keyboard input works after a switch. */
  focus(): void;
  element(): WebviewElement | null;
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
      back: () => {
        const wv = webviewRef.current;
        if (wv && safeCanGoBack(wv)) wv.goBack();
      },
      forward: () => {
        const wv = webviewRef.current;
        if (wv && safeCanGoForward(wv)) wv.goForward();
      },
      // Each call is feature-checked: <webview> methods only exist once Electron
      // has attached the guest, and an environment without them (jsdom, or a
      // webview that failed to attach) must not throw from a toolbar click.
      reload: () => {
        const wv = webviewRef.current;
        if (typeof wv?.reload === "function") wv.reload();
      },
      execute: (script: string) => {
        const wv = webviewRef.current;
        if (typeof wv?.executeJavaScript !== "function") return;
        void wv.executeJavaScript(script).catch(() => undefined);
      },
      focus: () => {
        const wv = webviewRef.current;
        if (typeof wv?.focus === "function") wv.focus();
      },
      element: () => webviewRef.current,
    }),
    [],
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
    wv.addEventListener("dom-ready", sync);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", sync);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("page-title-updated", onTitle);
      wv.removeEventListener("console-message", onConsole);
      wv.removeEventListener("dom-ready", sync);
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
