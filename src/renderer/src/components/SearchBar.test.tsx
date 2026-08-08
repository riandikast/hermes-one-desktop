import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

const hermesAPIMock = vi.hoisted(() => ({
  everythingSearch: vi.fn(async () => []),
  listFilesRecursive: vi.fn(async () => [
    { name: "app.ts", isDirectory: false, path: "C:/proj/app.ts" },
    { name: "styles", isDirectory: true, path: "C:/proj/styles" },
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

  it("focuses the input on Ctrl+F", () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Search files/));
  });

  it("searches files and dispatches hermes-open-file on a hit", async () => {
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

  it("hides the results dropdown after a file is picked, keeping the query", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "app" } });
    await screen.findByText("app.ts");

    fireEvent.click(screen.getByText("app.ts"));

    expect(screen.queryByText("app.ts")).toBeNull();
    expect(input.value).toBe("app");
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

  it("navigates results with ArrowDown/ArrowUp, opens on Enter, closes after pick", async () => {
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/);
    // "s" matches both mock entries (app.ts, styles) so the dropdown has two
    // options to navigate between.
    fireEvent.change(input, { target: { value: "s" } });
    await screen.findByText("app.ts");

    const optionPaths = [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.getAttribute("title"),
    );
    expect(optionPaths).toHaveLength(2);

    // ArrowDown from no selection → 0, ArrowDown → 1, ArrowUp wraps back to 0.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen.mock.calls[0][0].detail).toBe(optionPaths[0]);
    // Picking a file closes the dropdown but keeps the query.
    expect(screen.queryByText("app.ts")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("s");

    // Re-search (query change forces the debounced effect to re-run) and
    // arrow to index 1.
    fireEvent.change(input, { target: { value: "s " } });
    await screen.findByText("app.ts");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen.mock.calls[1][0].detail).toBe(optionPaths[1]);

    window.removeEventListener("hermes-open-file", onOpen);
  });

  it("Escape closes the results dropdown before clearing the query", async () => {
    render(<SearchBar initialFolders={FOLDERS} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "app" } });
    await screen.findByText("app.ts");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("app.ts")).toBeNull();
    expect(input.value).toBe("app");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.value).toBe("");
  });

  it("keeps results across re-renders with a new array identity but same folder content", async () => {
    const { rerender } = render(
      <SearchBar initialFolders={FOLDERS} sessionId={null} />,
    );

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "app" } });
    await screen.findByText("app.ts");

    // Layout re-renders pass a freshly-minted array with the same content
    // (e.g. `initialContextFolders ?? []`); results must survive.
    rerender(<SearchBar initialFolders={["C:/proj"]} sessionId={null} />);
    rerender(<SearchBar initialFolders={["C:/proj"]} sessionId={null} />);

    expect(screen.getByText("app.ts")).toBeTruthy();
  });

  it("re-seeds folders when the folder content actually changes", async () => {
    const { rerender } = render(
      <SearchBar initialFolders={FOLDERS} sessionId={null} />,
    );

    rerender(<SearchBar initialFolders={["C:/other"]} sessionId={null} />);

    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "x" } });

    await waitFor(() => {
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/other");
    });
    expect(hermesAPIMock.listFilesRecursive).not.toHaveBeenCalledWith("C:/proj");
  });
});
