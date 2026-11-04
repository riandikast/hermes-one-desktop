import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { WorktreePanel } from "./WorktreePanel";
import { appConfirm } from "../../components/modal/appConfirm";

vi.mock("../Command/TerminalDock", () => ({ TerminalDock: () => null }));
vi.mock("../../components/modal/appConfirm", () => ({
  appConfirm: vi.fn(async () => true),
}));

const renameExplorerEntry = vi.fn(async () => ({
  ok: true,
  path: "C:/proj/b.ts",
}));
const createExplorerEntry = vi.fn(
  async (
    _root: string,
    _parent: string,
    name: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> => ({
    ok: true,
    path: `C:/proj/${name}`,
  }),
);
const deleteExplorerEntry = vi.fn(async () => ({ ok: true }));
const copyExplorerEntry = vi.fn(async () => ({
  ok: true,
  path: "C:/proj/src/a.ts",
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      readDirectory: vi.fn(async (path: string) => {
        if (path === "C:/proj")
          return [
            { name: "src", isDirectory: true },
            { name: "a.ts", isDirectory: false },
          ];
        if (path === "C:/proj/src")
          return [{ name: "b.ts", isDirectory: false }];
        return [];
      }),
      listFilesRecursive: vi.fn(async () => []),
      everythingSearch: vi.fn(async () => []),
      watchContextFolder: vi.fn(async () => undefined),
      onContextFolderChanged: vi.fn(() => () => undefined),
      revealInExplorer: vi.fn(async () => true),
      openTerminal: vi.fn(async () => true),
      renameExplorerEntry,
      createExplorerEntry,
      deleteExplorerEntry,
      copyExplorerEntry,
    },
  });
});

function renderPanel(): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <WorktreePanel folderPaths={["C:/proj"]} embedded />
    </I18nProvider>,
  );
}

async function openMenuOn(path: string): Promise<void> {
  const row = await screen.findByTitle(path);
  fireEvent.contextMenu(row);
}

describe("explorer file operations", () => {
  it("renames through the in-app prompt", async () => {
    renderPanel();
    await openMenuOn("C:/proj/a.ts");
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    const input = await screen.findByRole("textbox", { name: "Rename" });
    expect((input as HTMLInputElement).value).toBe("a.ts");
    fireEvent.change(input, { target: { value: "b.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(renameExplorerEntry).toHaveBeenCalledWith(
        "C:/proj",
        "C:/proj/a.ts",
        "b.ts",
      ),
    );
  });

  it("creates a file in the row's folder and keeps API errors visible", async () => {
    createExplorerEntry.mockResolvedValueOnce({
      ok: false,
      error: "A file or folder with that name already exists",
    });
    renderPanel();
    await openMenuOn("C:/proj/a.ts");
    fireEvent.click(screen.getByRole("button", { name: /New File/ }));
    const input = await screen.findByRole("textbox", { name: "New File" });
    fireEvent.change(input, { target: { value: "c.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createExplorerEntry).toHaveBeenCalledWith(
        "C:/proj",
        "C:/proj",
        "c.ts",
        "file",
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already exists",
    );
  });

  it("copies a file and pastes it into another folder", async () => {
    renderPanel();
    await openMenuOn("C:/proj/a.ts");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await openMenuOn("C:/proj/src");
    fireEvent.click(screen.getByRole("button", { name: /Paste/ }));
    await waitFor(() =>
      expect(copyExplorerEntry).toHaveBeenCalledWith(
        "C:/proj",
        "C:/proj/a.ts",
        "C:/proj/src",
      ),
    );
  });

  it("confirms before trashing and never offers rename/delete on the root", async () => {
    renderPanel();
    await openMenuOn("C:/proj/a.ts");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(appConfirm).toHaveBeenCalledWith(
        'Move "a.ts" to the Recycle Bin?',
      ),
    );
    expect(deleteExplorerEntry).toHaveBeenCalledWith("C:/proj", "C:/proj/a.ts");

    await openMenuOn("C:/proj");
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
