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

  it("renders nothing until Ctrl+F", () => {
    render(<SearchBar folders={FOLDERS} />);
    expect(screen.queryByPlaceholderText(/Search files/)).toBeNull();
  });

  it("opens in files mode on Ctrl+F and dispatches hermes-open-file on a hit", async () => {
    const onOpen = vi.fn();
    window.addEventListener("hermes-open-file", onOpen);
    render(<SearchBar folders={FOLDERS} />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(input, { target: { value: "app" } });

    await waitFor(() => {
      expect(hermesAPIMock.listFilesRecursive).toHaveBeenCalledWith("C:/proj");
    });
    const row = await screen.findByText("app.ts");
    fireEvent.click(row);

    expect(onOpen).toHaveBeenCalledTimes(1);
    const detail = onOpen.mock.calls[0][0].detail;
    expect(detail).toBe("C:/proj/app.ts");
    window.removeEventListener("hermes-open-file", onOpen);
  });

  it("opens in content mode on Ctrl+Shift+F and searches file contents", async () => {
    render(<SearchBar folders={FOLDERS} />);

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

  it("closes on Escape", () => {
    render(<SearchBar folders={FOLDERS} />);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.getByPlaceholderText(/Search files/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/Search files/)).toBeNull();
  });
});
