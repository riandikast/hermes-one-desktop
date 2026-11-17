// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SidebarRecentSessions } from "./SidebarRecentSessions";

const rows = [
  { id: "a", title: "First chat", contextFolders: [] },
  { id: "b", title: "Second chat", contextFolders: [] },
  { id: "c", title: "Third chat", contextFolders: [] },
];
const deleteSessions = vi.fn(async (ids: string[]) => ({ requested: ids.length, deleted: ids.length }));
const onSelect = vi.fn();
let root: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  deleteSessions.mockClear();
  onSelect.mockClear();
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

describe("sidebar session multi-select", () => {
  it("selects from the row menu, adds with Ctrl-click, and deletes all selected at once", async () => {
    await mountSidebar();
    fireEvent.contextMenu(row("First chat"), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Select" }));
    expect(screen.getByLabelText("Select First chat")).toBeChecked();

    // While selecting, a plain click toggles instead of opening the chat.
    fireEvent.click(row("Third chat"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Select Third chat")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Delete (2)" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(deleteSessions).toHaveBeenCalledWith(["a", "c"]));
  });

  it("enters selection with Ctrl-click and leaves it with Escape", async () => {
    await mountSidebar();
    fireEvent.click(row("Second chat"), { ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Select Second chat")).toBeChecked();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Select Second chat")).toBeNull();
    fireEvent.click(row("Second chat"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
