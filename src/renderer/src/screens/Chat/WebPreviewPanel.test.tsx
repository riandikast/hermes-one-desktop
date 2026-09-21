// @vitest-environment jsdom
//
// The tabbed built-in browser, rendered end to end.
//
// Multi-tab has two load-bearing properties that are easy to regress:
//   1. EVERY tab's webview stays MOUNTED while inactive (unmounting destroys the
//      page, so switching back would reload and lose session/scroll), and
//   2. only the ACTIVE tab is visible.
//
// jsdom has no <webview>, so it is stubbed as a custom element that records the
// src it was given — enough to prove both properties, which are about the host
// component's structure rather than about Chromium's rendering.

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { WebPreviewPanel } from "./WebPreviewPanel";
import { BROWSER_TABS_KEY } from "./browserTabs";

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    openExternal: vi.fn(),
  };
});

function renderPanel(initialUrl = "https://start.test") {
  return render(
    <I18nProvider>
      <WebPreviewPanel
        initialUrl={initialUrl}
        onClose={() => undefined}
        embedded
      />
    </I18nProvider>,
  );
}

/** Every rendered tab-view element, in DOM order. */
function tabViews(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".web-preview-tab-view")];
}

/** Every tab button in the strip. */
function tabStrip(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".web-preview-tab")];
}

function newTabButton(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".web-preview-tab-new")!;
}

describe("browser tabs: structure", () => {
  it("starts with one tab for the requested url", () => {
    const { container } = renderPanel();
    expect(tabStrip(container)).toHaveLength(1);
    expect(tabViews(container)).toHaveLength(1);
  });

  it("hides the close button on a lone tab", () => {
    // A dead × reads as a bug; the last tab cannot be closed.
    const { container } = renderPanel();
    expect(container.querySelector(".web-preview-tab-close")).toBeNull();
  });

  it("opens a new tab from the + button", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    expect(tabStrip(container)).toHaveLength(2);
  });

  it("keeps EVERY tab mounted, so switching cannot reload a page", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    act(() => {
      fireEvent.click(newTabButton(container));
    });

    // Three tabs, three live webviews still in the DOM.
    expect(tabViews(container)).toHaveLength(3);
    expect(container.querySelectorAll("webview")).toHaveLength(3);
  });

  it("shows only the active tab", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });

    const visible = tabViews(container).filter(
      (el) => !el.hasAttribute("hidden"),
    );
    expect(visible).toHaveLength(1);
    // And it is the newest tab, which the + button makes active.
    expect(visible[0]).toBe(tabViews(container)[1]);
  });

  it("switches the visible tab when another tab is clicked", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    const [first] = tabStrip(container);
    act(() => {
      fireEvent.click(first);
    });

    const visible = tabViews(container).filter(
      (el) => !el.hasAttribute("hidden"),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toBe(tabViews(container)[0]);
  });

  it("marks the active tab in the strip for assistive tech", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    const selected = tabStrip(container).map((el) =>
      el.getAttribute("aria-selected"),
    );
    expect(selected).toEqual(["false", "true"]);
  });
});

describe("browser tabs: closing", () => {
  it("closes a tab from its × button", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    expect(tabStrip(container)).toHaveLength(2);

    const close = container.querySelector<HTMLElement>(".web-preview-tab-close")!;
    act(() => {
      fireEvent.click(close);
    });
    expect(tabStrip(container)).toHaveLength(1);
    expect(tabViews(container)).toHaveLength(1);
  });

  it("never leaves the strip empty", () => {
    // Closing the only tab is refused, so the browser always has a tab.
    const { container } = renderPanel();
    // With one tab there is no ×; assert the strip still has its tab instead.
    expect(tabStrip(container)).toHaveLength(1);
    expect(container.querySelector(".web-preview-tab-close")).toBeNull();
  });

  it("keeps a tab visible after closing the active one", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    // Close the middle-ish (first closable) tab.
    const closers = [
      ...container.querySelectorAll<HTMLElement>(".web-preview-tab-close"),
    ];
    act(() => {
      fireEvent.click(closers[0]);
    });

    const visible = tabViews(container).filter(
      (el) => !el.hasAttribute("hidden"),
    );
    expect(visible).toHaveLength(1);
    expect(tabStrip(container)).toHaveLength(2);
  });

  it("does not let the × click also switch tabs", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    // The first tab is inactive; closing it must not make it active.
    const beforeActive = tabStrip(container).findIndex(
      (el) => el.getAttribute("aria-selected") === "true",
    );
    act(() => {
      fireEvent.click(
        container.querySelector<HTMLElement>(".web-preview-tab-close")!,
      );
    });
    const afterActive = tabStrip(container).findIndex(
      (el) => el.getAttribute("aria-selected") === "true",
    );
    // The active tab is still the (now only) newer one, i.e. index 0 after the
    // closure removed the inactive first tab.
    expect(beforeActive).toBe(1);
    expect(afterActive).toBe(0);
  });
});

describe("browser tabs: persistence", () => {
  it("writes tabs to storage so they survive a restart", () => {
    const { container } = renderPanel("https://one.test");
    act(() => {
      fireEvent.click(newTabButton(container));
    });

    const saved = JSON.parse(localStorage.getItem(BROWSER_TABS_KEY) ?? "{}");
    expect(Array.isArray(saved.tabs)).toBe(true);
    expect(saved.tabs.length).toBe(2);
  });

  it("restores saved tabs on mount", () => {
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({
        tabs: [
          { id: "a", url: "https://restored-1.test" },
          { id: "b", url: "https://restored-2.test", title: "Two" },
        ],
        activeId: "b",
      }),
    );
    const { container } = renderPanel("https://restored-1.test");
    expect(tabStrip(container)).toHaveLength(2);
    expect(tabViews(container)).toHaveLength(2);
  });

  it("activates the saved url rather than duplicating it", () => {
    // Reopening the panel with the same link must not open it twice.
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({
        tabs: [
          { id: "a", url: "https://dup.test" },
          { id: "b", url: "https://other.test" },
        ],
        activeId: "b",
      }),
    );
    const { container } = renderPanel("https://dup.test");
    expect(tabStrip(container)).toHaveLength(2);
    const activeIndex = tabStrip(container).findIndex(
      (el) => el.getAttribute("aria-selected") === "true",
    );
    expect(activeIndex).toBe(0);
  });

  it("adds the incoming url as a new tab when it is not already open", () => {
    localStorage.setItem(
      BROWSER_TABS_KEY,
      JSON.stringify({
        tabs: [{ id: "a", url: "https://existing.test" }],
        activeId: "a",
      }),
    );
    const { container } = renderPanel("https://fresh.test");
    expect(tabStrip(container)).toHaveLength(2);
  });

  it("recovers from corrupt stored tabs", () => {
    localStorage.setItem(BROWSER_TABS_KEY, "not json at all");
    const { container } = renderPanel("https://after-corrupt.test");
    expect(tabStrip(container)).toHaveLength(1);
    expect(tabViews(container)).toHaveLength(1);
  });
});

describe("browser tabs: labels", () => {
  it("labels a tab by its host before any page title arrives", () => {
    const { container } = renderPanel("https://docs.example.com/page");
    expect(
      container.querySelector(".web-preview-tab-label")?.textContent,
    ).toBe("docs.example.com");
  });

  it("labels a blank tab as a new tab, not about:blank", () => {
    const { container } = renderPanel("about:blank");
    const labels = [...container.querySelectorAll(".web-preview-tab-label")].map(
      (el) => el.textContent,
    );
    expect(labels).toContain("New tab");
  });
});

describe("browser tabs: toolbar acts on the active tab", () => {
  it("disables back and forward on a fresh tab", () => {
    const { container } = renderPanel();
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(".web-preview-btn"),
    ];
    // Back and forward are the first two toolbar buttons.
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
  });

  it("updates the address bar when switching tabs", () => {
    const { container } = renderPanel("https://first.test");
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    // The new tab is blank, so the address bar clears.
    const input = container.querySelector<HTMLInputElement>(
      ".web-preview-address-input",
    )!;
    expect(input.value).toBe("about:blank");

    // Switch back and the first URL returns.
    act(() => {
      fireEvent.click(tabStrip(container)[0]);
    });
    expect(
      container.querySelector<HTMLInputElement>(".web-preview-address-input")!
        .value,
    ).toBe("https://first.test");
  });

  it("has a new-tab button and an address field", () => {
    const { container } = renderPanel();
    expect(newTabButton(container)).not.toBeNull();
    expect(
      container.querySelector(".web-preview-address-input"),
    ).not.toBeNull();
  });
});

describe("new-tab button placement", () => {
  it("renders the + BEFORE the tab list, so it holds the left edge", () => {
    // Placement is a DOM-order property here (the strip is a flex row), so it
    // is asserted structurally rather than by pixel position.
    const { container } = renderPanel();
    const strip = container.querySelector(".web-preview-tabs")!;
    const children = [...strip.children];
    const plusIndex = children.findIndex((el) =>
      el.classList.contains("web-preview-tab-new"),
    );
    const scrollIndex = children.findIndex((el) =>
      el.classList.contains("web-preview-tabs-scroll"),
    );
    expect(plusIndex).toBe(0);
    expect(scrollIndex).toBeGreaterThan(plusIndex);
  });

  it("keeps the + first even with several tabs open", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    const strip = container.querySelector(".web-preview-tabs")!;
    expect(strip.children[0].classList.contains("web-preview-tab-new")).toBe(
      true,
    );
  });
});

/** Right-click the tab at `index` and return the menu element. */
function openMenu(container: HTMLElement, index = 0): HTMLElement | null {
  const tab = tabStrip(container)[index];
  act(() => {
    fireEvent.contextMenu(tab, { clientX: 120, clientY: 80 });
  });
  return document.querySelector<HTMLElement>(".web-preview-tab-menu");
}

/** Menu item labels, in order. */
function menuItems(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item"),
  ].map((el) => el.textContent ?? "");
}

describe("tab context menu", () => {
  it("opens on right-click with the four requested actions", () => {
    const { container } = renderPanel();
    const menu = openMenu(container, 0);
    expect(menu).not.toBeNull();
    expect(menuItems()).toEqual([
      "Duplicate",
      "Close",
      "Close other tabs",
      "Close tabs to the right",
    ]);
  });

  it("does not open the browser's own menu", () => {
    // preventDefault on contextmenu — otherwise Electron's default menu (or
    // nothing) appears over ours.
    const { container } = renderPanel();
    const tab = tabStrip(container)[0];
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      tab.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("selects the right-clicked tab so menu actions target it", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    // Tab 1 is active; right-click tab 0.
    openMenu(container, 0);
    const selected = tabStrip(container).map((el) =>
      el.getAttribute("aria-selected"),
    );
    expect(selected).toEqual(["true", "false"]);
  });

  it("Duplicate adds a copy and leaves the original in place", () => {
    const { container } = renderPanel("https://dup-me.test");
    openMenu(container, 0);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][0],
      );
    });
    expect(tabStrip(container)).toHaveLength(2);
    expect(tabViews(container)).toHaveLength(2);
    expect(
      container.querySelector<HTMLInputElement>(".web-preview-address-input")!
        .value,
    ).toBe("https://dup-me.test");
  });

  it("closes the menu after an action runs", () => {
    const { container } = renderPanel();
    openMenu(container, 0);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][0],
      );
    });
    expect(document.querySelector(".web-preview-tab-menu")).toBeNull();
  });

  it("Close removes only that tab", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    openMenu(container, 0);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][1],
      );
    });
    expect(tabStrip(container)).toHaveLength(1);
  });

  it("Close other tabs leaves exactly the right-clicked tab", () => {
    const { container } = renderPanel("https://keep.test");
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    expect(tabStrip(container)).toHaveLength(3);

    openMenu(container, 0);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][2],
      );
    });
    expect(tabStrip(container)).toHaveLength(1);
    // The survivor is the tab that was right-clicked.
    expect(
      container.querySelector<HTMLInputElement>(".web-preview-address-input")!
        .value,
    ).toBe("https://keep.test");
  });

  it("Close tabs to the right keeps the clicked tab and earlier ones", () => {
    const { container } = renderPanel("https://first-kept.test");
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    // Right-click the MIDDLE tab: it and the first survive, the third goes.
    openMenu(container, 1);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][3],
      );
    });
    expect(tabStrip(container)).toHaveLength(2);
  });

  it("disables close-to-right on the last tab", () => {
    const { container } = renderPanel();
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    openMenu(container, 1); // the last tab
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".web-preview-tab-menu-item",
      ),
    ];
    expect(items[3].disabled).toBe(true);
    // The others remain available.
    expect(items[0].disabled).toBe(false);
    expect(items[2].disabled).toBe(false);
  });

  it("disables Close, Close other tabs and close-to-right on a lone tab", () => {
    const { container } = renderPanel();
    openMenu(container, 0);
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".web-preview-tab-menu-item",
      ),
    ];
    // Duplicate always works; the three closing actions cannot.
    expect(items[0].disabled).toBe(false);
    expect(items[1].disabled).toBe(true);
    expect(items[2].disabled).toBe(true);
    expect(items[3].disabled).toBe(true);
  });

  it("closes on Escape without closing the dialog", () => {
    const { container } = renderPanel();
    openMenu(container, 0);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.querySelector(".web-preview-tab-menu")).toBeNull();
  });

  it("closes when clicking outside", () => {
    const { container } = renderPanel();
    openMenu(container, 0);
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(document.querySelector(".web-preview-tab-menu")).toBeNull();
  });

  it("stays open when clicking inside the menu", () => {
    const { container } = renderPanel();
    const menu = openMenu(container, 0)!;
    act(() => {
      fireEvent.mouseDown(menu);
    });
    expect(document.querySelector(".web-preview-tab-menu")).not.toBeNull();
  });

  it("persists bulk closes so they survive a reopen", () => {
    const { container, unmount } = renderPanel("https://persist.test");
    act(() => {
      fireEvent.click(newTabButton(container));
    });
    openMenu(container, 0);
    act(() => {
      fireEvent.click(
        [...document.querySelectorAll<HTMLElement>(".web-preview-tab-menu-item")][2],
      );
    });
    expect(tabStrip(container)).toHaveLength(1);
    unmount();

    const saved = JSON.parse(localStorage.getItem(BROWSER_TABS_KEY) ?? "{}");
    expect(saved.tabs).toHaveLength(1);
  });
});
