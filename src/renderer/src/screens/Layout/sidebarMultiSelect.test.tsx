// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SidebarRecentSessions } from "./SidebarRecentSessions";

const all = [
  { id: "a", title: "First chat", contextFolders: [] },
  { id: "b", title: "Second chat", contextFolders: [] },
  { id: "c", title: "Third chat", contextFolders: [] },
];
let rows = all;
const deleteSessions = vi.fn();
const onSelect = vi.fn();
let root: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  rows = all;
  onSelect.mockClear();
  deleteSessions.mockReset().mockImplementation(async (ids: string[]) => {
    rows = rows.filter((row) => !ids.includes(row.id));
    return { requested: ids.length, deleted: ids.length };
  });
  window.hermesAPI = {
    listCachedSessions: vi.fn(async (limit: number, offset = 0) => rows.slice(offset, offset + limit)),
    syncSessionCache: vi.fn(async () => rows),
    listProfiles: vi.fn(async () => []),
    deleteSessions,
    deleteSession: vi.fn(async () => undefined),
  } as unknown as typeof window.hermesAPI;
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => {
  cleanup();
  root.remove();
});

async function mountSidebar(): Promise<void> {
  await act(async () => {
    renderWithI18n(<SidebarRecentSessions
      open activeProfile="default" currentSessionId={null}
      loadingSessionIds={new Set()} resumingSessionId={null}
      onSelect={onSelect} scrollRootRef={{ current: root }}
      searchOpen={false} onSearchOpenChange={vi.fn()} sidebarTab="sessions"
    />);
  });
  expect(screen.getByText("First chat")).toBeTruthy();
}

const row = (title: string): HTMLElement => screen.getByText(title).closest(".sidebar-recent-session") as HTMLElement;

async function selectFirstAndThird(): Promise<void> {
  fireEvent.contextMenu(row("First chat"), { clientX: 10, clientY: 10 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Select" }));
  expect(row("First chat")).toHaveAttribute("aria-checked", "true");
  // While selecting, a plain click toggles instead of opening the chat.
  fireEvent.click(row("Third chat"));
  expect(onSelect).not.toHaveBeenCalled();
  expect(row("Third chat")).toHaveAttribute("aria-checked", "true");
}

async function confirmDelete(count: number): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: `Delete ${count} selected` }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  });
}

describe("sidebar session multi-select", () => {
  it("selects from the row menu, adds by clicking, and deletes all selected at once", async () => {
    await mountSidebar();
    await selectFirstAndThird();
    await confirmDelete(2);
    expect(deleteSessions).toHaveBeenCalledWith(["a", "c"]);
    await waitFor(() => expect(screen.queryByText("First chat")).toBeNull());
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull();
  });

  it("keeps sessions the backend refused selected and says so", async () => {
    deleteSessions.mockImplementation(async (ids: string[]) => {
      rows = rows.filter((r) => r.id !== "a");
      return { requested: ids.length, deleted: 1, failed: ["c"] };
    });
    await mountSidebar();
    await selectFirstAndThird();
    await confirmDelete(2);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete 1");
    expect(row("Third chat")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.queryByText("First chat")).toBeNull());
  });

  it("enters selection with Ctrl-click and leaves it with Escape", async () => {
    await mountSidebar();
    fireEvent.click(row("Second chat"), { ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(row("Second chat")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row("Second chat")).not.toHaveAttribute("aria-checked");
    fireEvent.click(row("Second chat"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
