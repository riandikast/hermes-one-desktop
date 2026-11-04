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
const importExplorerEntry = vi.fn(async () => ({
  ok: true,
  path: "C:/proj/src/report.pdf",
}));
const readClipboardFiles = vi.fn(async (): Promise<string[]> => []);
const writeClipboardFiles = vi.fn(async () => undefined);
const listExplorerSshConnections = vi.fn(
  async () =>
    [] as Array<{
      id: string;
      label: string;
      host: string;
      port: number;
      username: string;
      keyPath: string;
      rootPath: string;
    }>,
);

beforeEach(() => {
  vi.clearAllMocks();
  readClipboardFiles.mockResolvedValue([]);
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
        if (path === "ssh://srv1/srv/app")
          return [{ name: "server.ts", isDirectory: false }];
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
      importExplorerEntry,
      readClipboardFiles,
      writeClipboardFiles,
      listExplorerSshConnections,
      saveExplorerSshConnection: vi.fn(async () => ({
        ok: false,
        error: "not used",
      })),
      deleteExplorerSshConnection: vi.fn(async () => ({ ok: true })),
      testExplorerSshConnection: vi.fn(async () => ({
        ok: true,
        home: "/srv/app",
      })),
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

  it("pastes files copied in Explorer through the OS clipboard", async () => {
    readClipboardFiles.mockResolvedValue(["D:/Downloads/report.pdf"]);
    renderPanel();
    await openMenuOn("C:/proj/src");
    const paste = await screen.findByRole("button", { name: "Paste" });
    await waitFor(() => expect(paste).toBeEnabled());
    fireEvent.click(paste);
    await waitFor(() =>
      expect(importExplorerEntry).toHaveBeenCalledWith(
        "C:/proj",
        "D:/Downloads/report.pdf",
        "C:/proj/src",
      ),
    );
  });

  it("copies and pastes with Ctrl+C and Ctrl+V on a focused row", async () => {
    renderPanel();
    const fileRow = await screen.findByTitle("C:/proj/a.ts");
    fireEvent.keyDown(fileRow, { key: "c", ctrlKey: true });
    expect(writeClipboardFiles).toHaveBeenCalledWith(["C:/proj/a.ts"]);
    const folderRow = await screen.findByTitle("C:/proj/src");
    fireEvent.keyDown(folderRow, { key: "v", ctrlKey: true });
    await waitFor(() =>
      expect(copyExplorerEntry).toHaveBeenCalledWith(
        "C:/proj",
        "C:/proj/a.ts",
        "C:/proj/src",
      ),
    );
  });

  it("browses a saved SSH root with no local folder attached", async () => {
    listExplorerSshConnections.mockResolvedValue([
      {
        id: "srv1",
        label: "prod",
        host: "10.0.0.5",
        port: 22,
        username: "root",
        keyPath: "",
        rootPath: "/srv/app",
      },
    ]);
    render(
      <I18nProvider>
        <WorktreePanel folderPaths={[]} embedded />
      </I18nProvider>,
    );
    expect(await screen.findByText("prod")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.hermesAPI.readDirectory).toHaveBeenCalledWith(
        "ssh://srv1/srv/app",
      ),
    );
    expect(await screen.findByText("server.ts")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTitle("ssh://srv1/srv/app"));
    fireEvent.click(await screen.findByRole("button", { name: /New File/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "New File" }), {
      target: { value: "worker.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createExplorerEntry).toHaveBeenCalledWith(
        "ssh://srv1/srv/app",
        "ssh://srv1/srv/app",
        "worker.ts",
        "file",
      ),
    );
  });

  it("asks for a password only after the first connection attempt", async () => {
    const save = vi.fn(async () => ({
      ok: true,
      connection: { id: "srv1", label: "prod" },
    }));
    const test = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        needsPassword: true,
        error: "SSH password required",
      })
      .mockResolvedValueOnce({ ok: true, home: "/home/me" });
    Object.assign(window.hermesAPI, {
      saveExplorerSshConnection: save,
      testExplorerSshConnection: test,
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect to SSH host" }),
    );
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "10.3.0.9" },
    });
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const password = await screen.findByLabelText("Password");
    expect(test).toHaveBeenLastCalledWith("srv1", undefined);
    fireEvent.change(password, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(test).toHaveBeenLastCalledWith("srv1", "secret"),
    );
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "srv1", host: "10.3.0.9", username: "me" }),
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
