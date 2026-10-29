import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { WorktreePanel } from "./WorktreePanel";

const files = (count: number): Array<{ name: string; isDirectory: boolean }> => Array.from({ length: count }, (_, index) => ({
  name: `file-${String(index).padStart(3, "0")}.ts`,
  isDirectory: false,
}));

let onChanged: (() => void) | undefined;
const readDirectory = vi.fn(async (path: string) => {
  if (path === "C:/proj") return [{ name: "src", isDirectory: true }, ...files(220)];
  if (path === "C:/proj/src") return files(230);
  return [];
});

beforeEach(() => {
  readDirectory.mockClear();
  onChanged = undefined;
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      readDirectory,
      listFilesRecursive: vi.fn(async () => [{ name: "src", isDirectory: true, path: "C:/proj/src" }]),
      everythingSearch: vi.fn(async () => []),
      watchContextFolder: vi.fn(async () => undefined),
      onContextFolderChanged: vi.fn((callback: () => void) => { onChanged = callback; return () => { onChanged = undefined; }; }),
    },
  });
});

function renderPanel(selectedPath?: string): ReturnType<typeof render> {
  return render(<I18nProvider><WorktreePanel folderPaths={["C:/proj"]} selectedPath={selectedPath} embedded /></I18nProvider>);
}

describe("large explorer folders", () => {
  it("bounds root rows while allowing every page to be opened", async () => {
    const view = renderPanel();
    await screen.findByText("file-000.ts");
    const root = view.container.querySelector(".worktree-root") as HTMLElement;
    expect(root.querySelectorAll(":scope > .worktree-children > .worktree-item")).toHaveLength(100);
    expect(screen.queryByText("file-219.ts")).toBeNull();
    fireEvent.click(within(root).getByRole("button", { name: "Next page" }));
    expect(screen.getByText("file-100.ts")).toBeTruthy();
    expect(screen.queryByText("file-000.ts")).toBeNull();
    fireEvent.click(within(root).getByRole("button", { name: "Next page" }));
    const last = screen.getByText("file-219.ts");
    const opened = vi.fn();
    window.addEventListener("hermes-open-file", opened);
    fireEvent.click(last);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe("C:/proj/file-219.ts");
    window.removeEventListener("hermes-open-file", opened);
    fireEvent.click(within(root).getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("file-100.ts")).toBeTruthy();
  });

  it("keeps rendering bounded for a directory with 20,000 files", async () => {
    readDirectory.mockImplementationOnce(async () => files(20_000));
    const view = renderPanel();
    await screen.findByText("file-000.ts");
    expect(view.container.querySelectorAll(".worktree-root > .worktree-children > .worktree-item")).toHaveLength(100);
    expect(view.container.querySelector(".worktree-pagination span")?.textContent).toMatch(/^1–100 of (20,?000)$/);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(view.container.querySelectorAll(".worktree-root > .worktree-children > .worktree-item")).toHaveLength(100);
  });

  it("bounds nested folders, including expandable search hits", async () => {
    const view = renderPanel();
    const folder = (await screen.findByText("src")).closest(".worktree-row") as HTMLElement;
    fireEvent.click(folder);
    await waitFor(() => expect(readDirectory).toHaveBeenCalledWith("C:/proj/src"));
    const nested = folder.parentElement as HTMLElement;
    await waitFor(() => expect(nested.querySelectorAll(":scope > .worktree-children > .worktree-item")).toHaveLength(100));
    fireEvent.click(within(nested).getByRole("button", { name: "Next page" }));
    expect(within(nested).getByText("file-100.ts")).toBeTruthy();

    fireEvent.change(view.container.querySelector(".worktree-search-input") as HTMLInputElement, { target: { value: "src" } });
    const hit = (await screen.findByText("src")).closest(".worktree-row") as HTMLElement;
    fireEvent.click(hit);
    const result = hit.parentElement as HTMLElement;
    await waitFor(() => expect(result.querySelectorAll(":scope > .worktree-children > .worktree-item")).toHaveLength(100));
    fireEvent.click(within(result).getByRole("button", { name: "Next page" }));
    expect(within(result).getByText("file-100.ts")).toBeTruthy();
  });

  it("keeps the current page and expanded folder during live refresh", async () => {
    const view = renderPanel();
    const folder = (await screen.findByText("src")).closest(".worktree-row") as HTMLElement;
    fireEvent.click(folder);
    const nested = folder.parentElement as HTMLElement;
    await waitFor(() => expect(within(nested).getByText("file-000.ts")).toBeTruthy());
    fireEvent.click(within(nested).getByRole("button", { name: "Next page" }));
    expect(within(nested).getByText("file-100.ts")).toBeTruthy();
    const calls = readDirectory.mock.calls.length;
    act(() => onChanged?.());
    await waitFor(() => expect(readDirectory.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(within(nested).getByText("file-100.ts")).toBeTruthy());
    expect(view.container.contains(nested)).toBe(true);
    expect(within(nested).queryByText("file-000.ts")).toBeNull();
  });

  it("automatically reveals a selected file on a later page", async () => {
    renderPanel("C:/proj/file-219.ts");
    const selected = await screen.findByText("file-219.ts");
    expect(selected.closest(".worktree-row")?.getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
