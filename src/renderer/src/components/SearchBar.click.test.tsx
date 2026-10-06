import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

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

  it("does NOT open a DIRECTORY as a file", async () => {
    // Directories are listed as results, but picking one must not dispatch a
    // file-open for a folder — the viewer cannot render it, so the click looks
    // like it did nothing.
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "styles" } });
    await screen.findByText("styles");

    const option = screen
      .getByText("styles")
      .closest('[role="option"]') as HTMLElement;
    fireEvent.click(option);

    // Either it dispatches a directory-aware detail, or it does not dispatch a
    // plain file open at all — never a bare file path for a folder.
    const calls = onOpen.mock.calls.map(
      (c) => (c[0] as CustomEvent).detail as { path: string; isDirectory?: boolean },
    );
    const openedAsFile = calls.filter((d) => d.isDirectory !== true);
    expect(openedAsFile).toHaveLength(0);
    window.removeEventListener("hermes-open-file", onOpen);
  });
});
