import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

const hermesAPIMock = vi.hoisted(() => ({
  everythingSearch: vi.fn(async () => []),
  listFilesRecursive: vi.fn(async () => [
    { name: "app.ts", isDirectory: false, path: "C:/proj/app.ts" },
    { name: "styles", isDirectory: true, path: "C:/proj/styles" },
  ]),
  searchInFiles: vi.fn(async () => [
    {
      path: "C:/proj/app.ts",
      matches: [{ line: 3, text: "const greeting = 'hi'" }],
    },
  ]),
}));

const FOLDERS = ["C:/proj"];

describe("SearchBar", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: hermesAPIMock,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is always visible (no keybind needed)", () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);
    expect(screen.getByPlaceholderText(/Search files/)).toBeTruthy();
  });

  it("switches to content mode on Ctrl+Shift+F and searches file contents", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    const input = screen.getByPlaceholderText(/Search inside files/);
    fireEvent.change(input, { target: { value: "greeting" } });

    await waitFor(() => {
      expect(hermesAPIMock.searchInFiles).toHaveBeenCalledWith(
        FOLDERS,
        "greeting",
      );
    });
    expect(await screen.findByText("const greeting = 'hi'")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // line number
  });

  it("searches files in files mode and dispatches hermes-open-file on a hit", async () => {
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "app" } });

    await waitFor(() => {
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/proj");
    });
    const row = await screen.findByText("app.ts");
    fireEvent.click(row);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].detail).toBe("C:/proj/app.ts");
    window.removeEventListener("hermes-open-file", onOpen);
  });

  it("adopts folders from the active session's folder-changed event", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId="sess-1" />);

    window.dispatchEvent(
      new CustomEvent("hermes-session-context-folder-changed", {
        detail: { sessionId: "sess-1", folders: ["C:/other"] },
      }),
    );

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "x" } });

    await waitFor(() => {
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/other");
    });
  });

  it("ignores folder-changed events from other sessions", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId="sess-1" />);

    window.dispatchEvent(
      new CustomEvent("hermes-session-context-folder-changed", {
        detail: { sessionId: "sess-2", folders: ["C:/other"] },
      }),
    );

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "x" } });

    await waitFor(() => {
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/proj");
    });
    expect(hermesAPIMock.listFilesRecursive).not.toHaveBeenCalledWith(
      "C:/other",
    );
  });

  it("clears the query on Escape", () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "app" } });
    expect(input.value).toBe("app");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.value).toBe("");
  });
});
