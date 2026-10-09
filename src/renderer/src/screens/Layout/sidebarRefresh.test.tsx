// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SidebarRecentSessions } from "./SidebarRecentSessions";

const existing = { id: "existing", title: "Existing chat", contextFolders: [] };
const created = {
  id: "new-session",
  title: "New folder conversation",
  contextFolders: ["C:/work/never-listed-project"],
};
let rows: Array<{ id: string; title: string; contextFolders: string[] }> = [existing];
const sync = vi.fn(async () => rows);
let root: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  rows = [existing];
  sync.mockReset().mockImplementation(async () => rows);
  vi.stubGlobal("hermesAPI", undefined);
  window.hermesAPI = {
    listCachedSessions: vi.fn(async (limit: number, offset = 0) => rows.slice(offset, offset + limit)),
    syncSessionCache: sync,
    listProfiles: vi.fn(async () => []),
  } as unknown as typeof window.hermesAPI;
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => {
  cleanup();
  root.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountSidebar(): Promise<void> {
  await act(async () => {
    renderWithI18n(<SidebarRecentSessions
      open activeProfile="default" currentSessionId={null}
      loadingSessionIds={new Set()} resumingSessionId={null}
      onSelect={vi.fn()} scrollRootRef={{ current: root }}
      searchOpen={false} onSearchOpenChange={vi.fn()} sidebarTab="sessions"
    />);
  });
  expect(screen.getByText("Existing chat")).toBeTruthy();
  expect(screen.queryByText("never-listed-project")).toBeNull();
  sync.mockClear();
  rows = [created, existing];
}

function expectNewProject(): void {
  expect(screen.getByText("never-listed-project")).toBeTruthy();
  expect(screen.getByText("New folder conversation")).toBeTruthy();
}

describe("sidebar refresh for a never-listed folder", () => {
  it.each(["hermes-session-db-synced", "hermes-session-context-folder-changed"])(
    "shows the new project while idle after %s, even within the throttle window",
    async (event) => {
      await mountSidebar();
      await act(async () => { window.dispatchEvent(new Event(event)); });
      expect(sync).toHaveBeenCalledTimes(1);
      expectNewProject();
    },
  );

  it("defers the event refresh until scrolling settles", async () => {
    await mountSidebar();
    await act(async () => {
      fireEvent.scroll(root);
      window.dispatchEvent(new Event("hermes-session-db-synced"));
    });
    expect(sync).not.toHaveBeenCalled();
    expect(screen.queryByText("never-listed-project")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(sync).toHaveBeenCalledTimes(1);
    expectNewProject();
  });

  it("defers applying a sync if scrolling starts during the request", async () => {
    await mountSidebar();
    let resolve!: (value: typeof rows) => void;
    sync.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => { window.dispatchEvent(new Event("hermes-session-db-synced")); });
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.scroll(root);
      resolve(rows);
    });
    expect(screen.queryByText("never-listed-project")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(sync).toHaveBeenCalledTimes(2);
    expectNewProject();
  });

  it("retains the 60-second polling refresh", async () => {
    await mountSidebar();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(sync).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(sync).toHaveBeenCalledTimes(1);
    expectNewProject();
  });
});
