// @vitest-environment jsdom
//
// The suggestion dropdown is gated on `folders.length > 0`, and folders arrive
// by two routes: the `initialFolders` prop, and live
// `hermes-session-context-folder-changed` events. The reported bug was the bar
// showing "Open a folder to search" in a chat that DID have a folder, so these
// pin the live-update route and its session scoping.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

const hermesAPIMock = vi.hoisted(() => ({
  everythingSearch: vi.fn(async () => []),
  listFilesRecursive: vi.fn(async () => [
    { name: "app.ts", isDirectory: false, path: "C:/proj/app.ts" },
  ]),
}));

function emitFolders(sessionId: string | null, folders: string[]): void {
  window.dispatchEvent(
    new CustomEvent("hermes-session-context-folder-changed", {
      detail: { sessionId, folders },
    }),
  );
}

beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: hermesAPIMock,
  });
  vi.clearAllMocks();
});

describe("SearchBar folder gating", () => {
  it("shows the empty-state placeholder with no folders", () => {
    render(<SearchBar initialFolders={[]} sessionId={null} />);
    expect(screen.getByPlaceholderText("Open a folder to search")).toBeTruthy();
  });

  it("becomes searchable when a live folder event arrives (the reported bug)", async () => {
    render(<SearchBar initialFolders={[]} sessionId="s1" />);
    // Starts locked.
    expect(screen.getByPlaceholderText("Open a folder to search")).toBeTruthy();

    emitFolders("s1", ["C:/proj"]);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search files…")).toBeTruthy(),
    );
    const input = screen.getByPlaceholderText("Search files…");
    fireEvent.change(input, { target: { value: "app" } });
    await waitFor(() =>
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/proj"),
    );
  });

  it("adopts a folder broadcast with a NULL session id while the run id settles", async () => {
    // A resumed session can broadcast with a null/stale id before the run's
    // session id is known; a strict `===` match dropped it and the bar stayed
    // locked forever.
    render(<SearchBar initialFolders={[]} sessionId="s1" />);
    emitFolders(null, ["C:/proj"]);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search files…")).toBeTruthy(),
    );
  });

  it("still ignores a DIFFERENT non-null session's folder change", async () => {
    const { rerender } = render(<SearchBar initialFolders={[]} sessionId="s1" />);
    emitFolders("other-session", ["C:/elsewhere"]);
    rerender(<SearchBar initialFolders={[]} sessionId="s1" />);
    // Background tab change must not hijack this tab's scope.
    expect(screen.getByPlaceholderText("Open a folder to search")).toBeTruthy();
  });

  it("seeds from the prop when provided", () => {
    render(<SearchBar initialFolders={["C:/proj"]} sessionId="s1" />);
    expect(screen.getByPlaceholderText("Search files…")).toBeTruthy();
  });
});
