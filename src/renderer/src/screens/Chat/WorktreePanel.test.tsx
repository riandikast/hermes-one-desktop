import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { WorktreePanel } from "./WorktreePanel";

/**
 * The explorer's SEARCH results.
 *
 * Reported: a folder hit was a flat, un-clickable row — "it just feels useless
 * if it on like single list for folder". These tests drive the real panel and
 * assert a directory hit EXPANDS to reveal its contents.
 */

const listFilesRecursive = vi.fn(async () => [
  { name: "src", isDirectory: true, path: "C:/proj/src" },
  { name: "readme.md", isDirectory: false, path: "C:/proj/readme.md" },
]);
const readDirectory = vi.fn(async (path: string) => {
  if (path === "C:/proj/src") {
    return [
      { name: "nested", isDirectory: true, path: "C:/proj/src/nested" },
      { name: "index.ts", isDirectory: false, path: "C:/proj/src/index.ts" },
    ];
  }
  return [];
});

beforeEach(() => {
  listFilesRecursive.mockClear();
  readDirectory.mockClear();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listFilesRecursive,
      readDirectory,
      everythingSearch: vi.fn(async () => []),
      // The panel watches the root folders for external changes on mount.
      watchContextFolder: vi.fn(async () => undefined),
      onContextFolderChanged: vi.fn(() => () => {}),
    },
  });
});
afterEach(() => vi.clearAllMocks());

const renderPanel = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <WorktreePanel folderPaths={["C:/proj"]} embedded />
    </I18nProvider>,
  );

const searchFor = async (text: string, expectText: string): Promise<void> => {
  const input = document.querySelector(
    ".worktree-search-input",
  ) as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { value: text } });
  // The panel debounces the query.
  await screen.findByText(expectText, {}, { timeout: 3000 });
};

describe("WorktreePanel search results", () => {
  it("shows a folder hit as an expandable row (chevron present)", async () => {
    renderPanel();
    await searchFor("src", "src");

    const row = screen.getByText("src").closest(".worktree-row") as HTMLElement;
    expect(row).toBeTruthy();
    // A folder hit must carry a real chevron, not the blank spacer files get.
    expect(row.querySelector(".worktree-chevron")).toBeTruthy();
    expect(row.querySelector(".worktree-chevron-placeholder")).toBeNull();
  });

  it("EXPANDS a folder hit to reveal what is inside", async () => {
    renderPanel();
    await searchFor("src", "src");
    // The ROOT tree loads on mount; ignore that call.
    readDirectory.mockClear();

    const row = screen.getByText("src").closest(".worktree-row") as HTMLElement;
    fireEvent.click(row);

    // Reads the folder from its ABSOLUTE path and shows the children.
    await waitFor(() =>
      expect(readDirectory).toHaveBeenCalledWith("C:/proj/src"),
    );
    expect(await screen.findByText("index.ts")).toBeTruthy();
    expect(await screen.findByText("nested")).toBeTruthy();
  });

  it("collapses the folder hit again on a second click", async () => {
    renderPanel();
    await searchFor("src", "src");

    const row = screen.getByText("src").closest(".worktree-row") as HTMLElement;
    fireEvent.click(row);
    expect(await screen.findByText("index.ts")).toBeTruthy();

    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText("index.ts")).toBeNull());
  });

  it("opens a FILE hit (does not expand it)", async () => {
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    renderPanel();
    await searchFor("readme", "readme.md");
    readDirectory.mockClear();

    const row = screen
      .getByText("readme.md")
      .closest(".worktree-row") as HTMLElement;
    fireEvent.click(row);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toBe(
      "C:/proj/readme.md",
    );
    expect(readDirectory).not.toHaveBeenCalled();
    window.removeEventListener("hermes-open-file", onOpen);
  });
});
