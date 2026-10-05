// @vitest-environment jsdom
//
// Guest readiness in BrowserTabView.
//
// THE CRASH THIS GUARDS: `<webview>` exposes reload/goBack/executeJavaScript as
// ordinary functions IMMEDIATELY, so a `typeof === "function"` check passes
// while the guest is still attaching — and the call then throws
//   "The WebView must be attached to the DOM and the dom-ready event emitted
//    before this method can be called."
// Electron's WebviewTag has no isConnected()/isDestroyed(), so readiness must
// come from the `dom-ready` event, and calls made too early must be QUEUED
// rather than dropped.

import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserTabView,
  isPdfUrl,
  type BrowserTabViewHandle,
} from "./BrowserTabView";
import type { BrowserTab } from "./browserTabs";

/**
 * The guest methods the component may call, so each can be observed.
 *
 * `focus` is OMITTED from the intersection below: HTMLElement already declares
 * it with its own overload, and intersecting the two makes the assignment a
 * type error for no benefit.
 */
interface GuestMethods {
  reload: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  getTitle: () => string;
}

type MockWebview = HTMLElement & GuestMethods;

/**
 * Make `document.createElement("webview")` produce an element carrying the
 * guest methods.
 *
 * jsdom enforces the custom-element naming rule (a dash is required), so the
 * `webview` tag cannot be registered as a custom element and React's
 * createElement would hand back a bare HTMLElement with none of the guest API.
 * Patching createElement is the smallest honest seam: the component's REAL code
 * path runs unchanged, and the stub simply records which guest methods were
 * called (and when) so the readiness logic is observable.
 */
function installWebviewStub(): MockWebview[] {
  const made: MockWebview[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, options?: ElementCreationOptions): HTMLElement => {
      const el = original(tag, options) as HTMLElement;
      if (tag.toLowerCase() !== "webview") return el;
      const wv = el as MockWebview;
      wv.reload = vi.fn();
      wv.goBack = vi.fn();
      wv.goForward = vi.fn();
      wv.loadURL = vi.fn().mockResolvedValue(undefined);
      wv.executeJavaScript = vi.fn().mockResolvedValue(undefined);
      wv.canGoBack = () => false;
      wv.canGoForward = () => false;
      wv.getURL = () => "";
      wv.getTitle = () => "";
      made.push(wv);
      return wv;
    },
  );
  return made;
}

/** Module-level handle to the stub's created elements for the current test. */
let created: MockWebview[] = [];

const TAB: BrowserTab = { id: "t1", url: "https://example.test" };

function renderView(): {
  ref: React.RefObject<BrowserTabViewHandle | null>;
  wv: MockWebview;
} {
  const ref = createRef<BrowserTabViewHandle>();
  render(
    <BrowserTabView
      ref={ref}
      tab={TAB}
      active
      onNavigated={() => undefined}
      onTitleChange={() => undefined}
      onNavStateChange={() => undefined}
    />,
  );
  const wv = created[0];
  expect(wv).toBeDefined();
  return { ref, wv };
}

/** Fire an event on the webview the way Electron's guest would. */
function guestEvent(wv: MockWebview, type: string): void {
  act(() => {
    wv.dispatchEvent(new Event(type));
  });
}

beforeEach(() => {
  created = installWebviewStub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guest is NOT ready before dom-ready", () => {
  it("does not call reload on the guest before dom-ready", () => {
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.reload();
    });
    expect(wv.reload).not.toHaveBeenCalled();
  });

  it("does not call executeJavaScript before dom-ready", () => {
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.execute("1 + 1");
    });
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it("does not call goBack/goForward before dom-ready", () => {
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.back();
      ref.current?.forward();
    });
    expect(wv.goBack).not.toHaveBeenCalled();
    expect(wv.goForward).not.toHaveBeenCalled();
  });

  it("reports itself as not ready", () => {
    const { ref } = renderView();
    expect(ref.current?.isReady()).toBe(false);
  });
});

describe("queued calls run after dom-ready", () => {
  it("replays a reload issued before the guest attached", () => {
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.reload();
    });
    expect(wv.reload).not.toHaveBeenCalled();

    guestEvent(wv, "dom-ready");

    // Replayed, not dropped: an early click must still take effect.
    expect(wv.reload).toHaveBeenCalledTimes(1);
    expect(ref.current?.isReady()).toBe(true);
  });

  it("replays queued calls in the order they were made", () => {
    const { ref, wv } = renderView();
    const order: string[] = [];
    wv.reload = vi.fn(() => order.push("reload"));
    wv.executeJavaScript = vi.fn(() => {
      order.push("execute");
      return Promise.resolve();
    });

    act(() => {
      ref.current?.reload();
      ref.current?.execute("x");
    });
    guestEvent(wv, "dom-ready");

    expect(order).toEqual(["reload", "execute"]);
  });

  it("calls the guest directly once ready", () => {
    const { ref, wv } = renderView();
    guestEvent(wv, "dom-ready");

    act(() => {
      ref.current?.reload();
    });
    expect(wv.reload).toHaveBeenCalledTimes(1);
  });

  it("does not replay the same queued call twice", () => {
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.reload();
    });
    guestEvent(wv, "dom-ready");
    guestEvent(wv, "dom-ready"); // a second dom-ready (reload, in-page nav)
    expect(wv.reload).toHaveBeenCalledTimes(1);
  });
});

describe("a failed guest call never throws", () => {
  it("swallows a throw from a guest method", () => {
    // The guest can die between the readiness check and the call.
    const { ref, wv } = renderView();
    guestEvent(wv, "dom-ready");
    wv.reload = vi.fn(() => {
      throw new Error("The WebView must be attached to the DOM");
    });

    // Must not propagate into React's event/render path.
    expect(() =>
      act(() => {
        ref.current?.reload();
      }),
    ).not.toThrow();
  });

  it("swallows a throw from a QUEUED call during the replay", () => {
    const { ref, wv } = renderView();
    wv.reload = vi.fn(() => {
      throw new Error("boom");
    });
    act(() => {
      ref.current?.reload();
    });
    // The replay must not break out of the loop and strand later callbacks.
    expect(() => guestEvent(wv, "dom-ready")).not.toThrow();
  });

  it("still replays later queued calls after one throws", () => {
    const { ref, wv } = renderView();
    const after = vi.fn();
    wv.reload = vi.fn(() => {
      throw new Error("boom");
    });
    wv.executeJavaScript = vi.fn(() => {
      after();
      return Promise.resolve();
    });

    act(() => {
      ref.current?.reload();
      ref.current?.execute("y");
    });
    guestEvent(wv, "dom-ready");

    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("address-bar navigation", () => {
  it("queues loadURL until the guest is ready, then applies it", () => {
    // THE REPORTED CRASH: typing in the address bar on a new tab called
    // executeJavaScript before dom-ready, which throws
    // "The WebView must be attached to the DOM...". loadURL is queued instead.
    const { ref, wv } = renderView();
    act(() => {
      ref.current?.loadURL("https://nav.test");
    });
    expect(wv.loadURL).not.toHaveBeenCalled();

    guestEvent(wv, "dom-ready");

    expect(wv.loadURL).toHaveBeenCalledWith("https://nav.test");
  });

  it("navigates directly once the guest is up", () => {
    const { ref, wv } = renderView();
    guestEvent(wv, "dom-ready");
    act(() => {
      ref.current?.loadURL("https://later.test");
    });
    expect(wv.loadURL).toHaveBeenCalledWith("https://later.test");
  });

  it("does not throw when loadURL rejects", () => {
    const { ref, wv } = renderView();
    guestEvent(wv, "dom-ready");
    wv.loadURL = vi.fn().mockRejectedValue(new Error("ERR_ABORTED"));
    expect(() =>
      act(() => {
        ref.current?.loadURL("https://bad.test");
      }),
    ).not.toThrow();
  });
});

describe("crash handling", () => {
  it("marks the guest not-ready again after a crash", () => {
    const { ref, wv } = renderView();
    guestEvent(wv, "dom-ready");
    expect(ref.current?.isReady()).toBe(true);

    guestEvent(wv, "crashed");

    // A crashed guest is unusable: calls must queue, not throw.
    expect(ref.current?.isReady()).toBe(false);
    act(() => {
      ref.current?.reload();
    });
    expect(wv.reload).not.toHaveBeenCalled();
  });
});

describe("host wiring", () => {
  it("emits an initial navigation state so the toolbar is not stuck", () => {
    const onNavStateChange = vi.fn();
    const ref = createRef<BrowserTabViewHandle>();
    render(
      <BrowserTabView
        ref={ref}
        tab={TAB}
        active
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={onNavStateChange}
      />,
    );
    const wv = created[0];
    guestEvent(wv, "dom-ready");

    expect(onNavStateChange).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({
        canGoBack: false,
        canGoForward: false,
      }),
    );
  });

  it("hides an inactive tab without unmounting it", () => {
    const ref = createRef<BrowserTabViewHandle>();
    const { container } = render(
      <BrowserTabView
        ref={ref}
        tab={TAB}
        active={false}
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={() => undefined}
      />,
    );
    const view = container.querySelector(".web-preview-tab-view");
    expect(view).not.toBeNull();
    expect(view?.hasAttribute("hidden")).toBe(true);
    // The guest is still in the DOM — that is what preserves the page.
    expect(container.querySelector("webview")).not.toBeNull();
  });

  it("sets the src attribute from the tab url", () => {
    const ref = createRef<BrowserTabViewHandle>();
    const { container } = render(
      <BrowserTabView
        ref={ref}
        tab={{ id: "t9", url: "https://src.test/page" }}
        active
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={() => undefined}
      />,
    );
    expect(container.querySelector("webview")?.getAttribute("src")).toBe(
      "https://src.test/page",
    );
  });
});

describe("isPdfUrl", () => {
  it("matches a .pdf path, with or without query/hash", () => {
    expect(isPdfUrl("https://x.test/doc.pdf")).toBe(true);
    expect(isPdfUrl("file:///C:/tmp/report.PDF")).toBe(true);
    expect(isPdfUrl("https://x.test/doc.pdf?token=1")).toBe(true);
    expect(isPdfUrl("https://x.test/doc.pdf#page=3")).toBe(true);
  });

  it("matches an explicit pdf data/blob URL", () => {
    expect(isPdfUrl("data:application/pdf;base64,AAAA")).toBe(true);
    expect(isPdfUrl("blob:https://x.test/abc-pdf-1")).toBe(true);
  });

  it("does not match ordinary pages", () => {
    expect(isPdfUrl("https://x.test/index.html")).toBe(false);
    expect(isPdfUrl("https://x.test/")).toBe(false);
    expect(isPdfUrl("")).toBe(false);
    // A query that merely CONTAINS "pdf" is not a PDF document.
    expect(isPdfUrl("https://x.test/view?file=pdf")).toBe(false);
    expect(isPdfUrl("https://x.test/app.js")).toBe(false);
  });
});

describe("PDF refit nudge on load", () => {
  /** A webview that reports a laid-out box, so the nudge proceeds immediately. */
  function laidOut(wv: MockWebview): void {
    Object.defineProperty(wv, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(wv, "clientWidth", {
      value: 600,
      configurable: true,
    });
  }

  it("flashes the webview size for a PDF so Chromium re-measures its zoom", () => {
    const ref = createRef<BrowserTabViewHandle>();
    const { container } = render(
      <BrowserTabView
        ref={ref}
        tab={{ id: "pdf1", url: "https://x.test/doc.pdf" }}
        active
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={() => undefined}
      />,
    );
    const wv = created[0];
    const el = container.querySelector("webview") as MockWebview;
    laidOut(wv);
    // Pin getURL so the guard sees a PDF regardless of the src attribute.
    wv.getURL = () => "https://x.test/doc.pdf";
    const styleBefore = el.style.width;
    guestEvent(wv, "did-stop-loading");
    // The nudge writes an inline size immediately (then restores it next frame).
    expect(el.style.width).not.toBe(styleBefore);
    expect(el.style.width).toContain("calc");
  });

  it("does not resize an ordinary page", () => {
    const ref = createRef<BrowserTabViewHandle>();
    const { container } = render(
      <BrowserTabView
        ref={ref}
        tab={{ id: "web1", url: "https://x.test/index.html" }}
        active
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={() => undefined}
      />,
    );
    const wv = created[0];
    const el = container.querySelector("webview") as MockWebview;
    laidOut(wv);
    wv.getURL = () => "https://x.test/index.html";
    guestEvent(wv, "did-stop-loading");
    expect(el.style.width).toBe("");
  });

  it("waits for a real layout box before nudging (never measures 0-height)", () => {
    const ref = createRef<BrowserTabViewHandle>();
    const { container } = render(
      <BrowserTabView
        ref={ref}
        tab={{ id: "pdf2", url: "https://x.test/slow.pdf" }}
        active
        onNavigated={() => undefined}
        onTitleChange={() => undefined}
        onNavStateChange={() => undefined}
      />,
    );
    const wv = created[0];
    const el = container.querySelector("webview") as MockWebview;
    // clientHeight/clientWidth stay 0 -> the nudge must not fire yet.
    wv.getURL = () => "https://x.test/slow.pdf";
    guestEvent(wv, "did-stop-loading");
    expect(el.style.width).toBe("");
  });
});
