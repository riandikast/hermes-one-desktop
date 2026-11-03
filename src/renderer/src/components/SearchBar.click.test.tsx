import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";
import appCss from "../assets/main.css?raw";

/**
 * CLICKING a search result must open the file.
 *
 * The keyboard path (ArrowDown + Enter) was covered; the MOUSE path was not —
 * and that is the reported failure ("if i search file and click on it they wont
 * open"). These tests click the real result button and assert the open event is
 * dispatched with the file's path.
 */

const hermesAPIMock = vi.hoisted(() => ({
  everythingSearch: vi.fn(async () => []),
  listFilesRecursive: vi.fn(async () => [
    { name: "app.ts", isDirectory: false, path: "C:/proj/app.ts" },
    { name: "styles", isDirectory: true, path: "C:/proj/styles" },
  ]),
}));

const FOLDERS = ["C:/proj"];

describe("SearchBar result clicks", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: hermesAPIMock,
    });
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  const search = async (text: string): Promise<void> => {
    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: text } });
    await screen.findByText("app.ts");
  };

  it("keeps the results panel out of the window drag region", () => {
    // The panel hangs past the title bar into the tab strip, which is an
    // app-region drag band. Native mouse events over that band are swallowed by
    // the OS-level drag region regardless of z-order: the first row could not
    // be hovered or clicked, while arrow keys (DOM events) still worked.
    const block = (selector: string): string => {
      const start = appCss.indexOf(`\n${selector} {`);
      if (start < 0) throw new Error(`Missing CSS block: ${selector}`);
      const open = appCss.indexOf("{", start);
      return appCss.slice(open + 1, appCss.indexOf("}", open));
    };
    expect(block(".active-sessions-bar")).toContain("-webkit-app-region: drag");
    expect(block(".search-bar-results")).toContain("-webkit-app-region: no-drag");
    // It must still open BELOW the field, which is what lands it on the band.
    expect(block(".search-bar-results")).toContain("top: 100%");
  });

  it("portals the results panel out of the window drag region", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);
    await search("app");
    const list = screen.getByRole("listbox");
    // A panel nested inside the title bar's drag element is still hit-tested
    // as drag territory, which is what made the first row unclickable.
    expect(list.parentElement).toBe(document.body);
    const block = (selector: string): string => {
      const start = appCss.indexOf(`\n${selector} {`);
      if (start < 0) throw new Error(`Missing CSS block: ${selector}`);
      const open = appCss.indexOf("{", start);
      return appCss.slice(open + 1, appCss.indexOf("}", open));
    };
    expect(block(".search-bar-results--portal")).toContain("position: fixed");
    expect(block(".search-bar-results--portal")).toContain("z-index: 1003");
    expect(block(".search-bar-results")).toContain("-webkit-app-region: no-drag");
  });

  it("dispatches hermes-open-file when a result is CLICKED", async () => {
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    await search("app");
    const option = screen
      .getByText("app.ts")
      .closest('[role="option"]') as HTMLElement;
    expect(option).toBeTruthy();

    fireEvent.click(option);

    expect(onOpen).toHaveBeenCalledTimes(1);
    const detail = (onOpen.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.path).toBe("C:/proj/app.ts");
    window.removeEventListener("hermes-open-file", onOpen);
  });

  it("closes the dropdown after a click", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);
    await search("app");

    const option = screen
      .getByText("app.ts")
      .closest('[role="option"]') as HTMLElement;
    fireEvent.click(option);

    expect(screen.queryByText("app.ts")).toBeNull();
  });

  it("opens the FILE EXPLORER for a directory (not a file tab)", async () => {
    // Directories are listed as results. Picking one must not dispatch a
    // file-open (the viewer cannot render a folder — that was the "click a
    // result and nothing opens" bug), and instead must ask the explorer to open
    // pointed at that folder.
    const onOpen = vi.fn();
    const onOpenFolder = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    window.addEventListener("hermes-open-folder-in-explorer", onOpenFolder);
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "styles" } });
    await screen.findByText("styles");

    const option = screen
      .getByText("styles")
      .closest('[role="option"]') as HTMLElement;
    fireEvent.click(option);

    // Never a bare file-open for a folder.
    expect(onOpen).not.toHaveBeenCalled();
    // The explorer opens on the folder.
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
    const detail = (onOpenFolder.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.path).toBe("C:/proj/styles");

    window.removeEventListener("hermes-open-file", onOpen);
    window.removeEventListener("hermes-open-folder-in-explorer", onOpenFolder);
  });

  it("closes the dropdown after picking a directory", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);
    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "styles" } });
    await screen.findByText("styles");

    const option = screen
      .getByText("styles")
      .closest('[role="option"]') as HTMLElement;
    fireEvent.click(option);

    expect(screen.queryByText("styles")).toBeNull();
  });
});
