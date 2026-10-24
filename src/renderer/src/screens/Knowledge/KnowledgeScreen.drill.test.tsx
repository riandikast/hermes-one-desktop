// @vitest-environment jsdom
//
// Knowledge is a DRILL-DOWN, not side-by-side panes: the full-width surface
// shows the bundle grid, then that bundle's file list, then the editor, each
// with a back control. These assert the navigation chain and — importantly —
// that back returns one level at a time rather than jumping to the top.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function mockBundles(): void {
  (window as any).hermesAPI = {
    listKnowledgeBundles: vi.fn().mockResolvedValue([
      {
        name: "ui-style-guide",
        path: "/home/.hermes/knowledge/ui-style-guide",
        files: [
          {
            name: "colors.md",
            relativePath: "ui-style-guide/colors.md",
            path: "/home/.hermes/knowledge/ui-style-guide/colors.md",
            size: 100,
          },
          {
            name: "spacing.md",
            relativePath: "ui-style-guide/spacing.md",
            path: "/home/.hermes/knowledge/ui-style-guide/spacing.md",
            size: 50,
          },
        ],
      },
    ]),
    readKnowledgeFile: vi.fn().mockResolvedValue("# colors"),
  };
}

const q = <T extends Element>(sel: string): T | null =>
  document.querySelector<T>(sel);

/** Grid → file list, via the bundle card. */
async function openBundle(): Promise<void> {
  render(<KnowledgeScreen />);
  await screen.findByText("ui-style-guide");
  fireEvent.click(q(".knowledge-bundle-open")!);
  await waitFor(() => expect(q(".knowledge-file-list")).not.toBeNull());
}

/** Grid → file list → editor, via a file card. */
async function openFile(): Promise<void> {
  await openBundle();
  fireEvent.click(q(".knowledge-file-open")!);
  await waitFor(() => expect(q(".knowledge-editor-container")).not.toBeNull());
}

describe("knowledge drill-down navigation", () => {
  // @lat: [[knowledge-editor#Creating bundles]]
  it("opens the canonical empty bundle after creation, including from an editor", async () => {
    mockBundles();
    const api = window.hermesAPI;
    const created = { name: "Team-notes-", path: "/k/Team-notes-", files: [] };
    api.createKnowledgeBundle = vi.fn().mockResolvedValue(created);
    await openFile();
    vi.mocked(api.listKnowledgeBundles).mockResolvedValue([created]);

    fireEvent.click(screen.getByRole("button", { name: "New Bundle" }));
    fireEvent.change(
      screen.getByPlaceholderText("Bundle name (e.g. ui-guidelines)..."),
      {
        target: { value: "  Team notes!  " },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(q(".knowledge-drill-title")?.textContent).toBe(created.name),
    );
    expect(api.createKnowledgeBundle).toHaveBeenCalledWith("Team notes!");
    expect(api.listKnowledgeBundles).toHaveBeenCalledTimes(2);
    expect(q(".knowledge-drill-count")?.textContent).toBe("0 files");
    expect(q(".knowledge-drill-empty")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add File" })).toBeTruthy();
    expect(q(".knowledge-editor-container")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to bundles" }));
    await screen.findByText(created.name);
    expect(q(".knowledge-bundle-list")).not.toBeNull();
  });

  it("keeps the typed name and shows creation failures for retry", async () => {
    mockBundles();
    window.hermesAPI.createKnowledgeBundle = vi
      .fn()
      .mockRejectedValue(new Error("Permission denied"));
    render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");
    fireEvent.click(screen.getByRole("button", { name: "New Bundle" }));
    const input = screen.getByPlaceholderText(
      "Bundle name (e.g. ui-guidelines)...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Team notes!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Permission denied",
    );
    expect(input.value).toBe("Team notes!");
    expect(q(".knowledge-bundle-list")).not.toBeNull();
    const created = { name: "Team-notes-", path: "/k/Team-notes-", files: [] };
    vi.mocked(window.hermesAPI.createKnowledgeBundle).mockResolvedValue(
      created,
    );
    vi.mocked(window.hermesAPI.listKnowledgeBundles).mockResolvedValue([
      created,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(q(".knowledge-drill-title")?.textContent).toBe(created.name),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens a newly created empty bundle from the grid rather than a blank surface", async () => {
    mockBundles();
    const created = { name: "New-bundle-", path: "/k/New-bundle-", files: [] };
    window.hermesAPI.createKnowledgeBundle = vi.fn().mockResolvedValue(created);
    render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");
    vi.mocked(window.hermesAPI.listKnowledgeBundles).mockResolvedValue([
      created,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "New Bundle" }));
    fireEvent.change(
      screen.getByPlaceholderText("Bundle name (e.g. ui-guidelines)..."),
      {
        target: { value: "New bundle!" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(q(".knowledge-drill-title")?.textContent).toBe(created.name),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add File" }));
    expect(q(".knowledge-add-file-bar--files input")).not.toBeNull();
    expect(q(".knowledge-drill-empty")).not.toBeNull();
  });
  it("starts on the bundle grid with no file list or editor", async () => {
    mockBundles();
    render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    expect(q(".knowledge-bundle-list")).not.toBeNull();
    expect(q(".knowledge-file-list")).toBeNull();
    expect(q(".knowledge-editor-container")).toBeNull();
  });

  it("renders NOTHING side by side — one surface at a time", async () => {
    mockBundles();
    await openBundle();

    // The old layout mounted the bundle sidebar AND the editor together.
    expect(q(".knowledge-sidebar")).toBeNull();
    expect(q(".knowledge-editor-container")).toBeNull();
    expect(q(".knowledge-bundle-list")).toBeNull();
  });

  it("drills from the grid into the bundle's file list", async () => {
    mockBundles();
    await openBundle();

    // Both files of that bundle, as cards.
    const names = [...document.querySelectorAll(".knowledge-row-name")];
    expect(names.map((n) => n.textContent)).toEqual([
      "colors.md",
      "spacing.md",
    ]);
    // The grid is replaced, not shown alongside.
    expect(q(".knowledge-bundle-list")).toBeNull();
  });

  it("drills from the file list into the editor", async () => {
    mockBundles();
    await openFile();

    expect(q(".knowledge-file-list")).toBeNull();
    expect(q(".file-title")?.textContent).toBe("colors.md");
  });

  it("goes back from the editor to the FILE LIST, not the grid", async () => {
    mockBundles();
    await openFile();

    fireEvent.click(q(".knowledge-back-btn")!);

    await waitFor(() => expect(q(".knowledge-file-list")).not.toBeNull());
    // One level only: the grid must NOT reappear here.
    expect(q(".knowledge-bundle-list")).toBeNull();
  });

  it("goes back from the file list to the bundle grid", async () => {
    mockBundles();
    await openBundle();

    fireEvent.click(q(".knowledge-back-btn")!);

    await waitFor(() => expect(q(".knowledge-bundle-list")).not.toBeNull());
    expect(q(".knowledge-file-list")).toBeNull();
  });

  it("supports the full round trip back to the grid", async () => {
    mockBundles();
    await openFile();

    fireEvent.click(q(".knowledge-back-btn")!); // editor -> files
    await waitFor(() => expect(q(".knowledge-file-list")).not.toBeNull());
    fireEvent.click(q(".knowledge-back-btn")!); // files -> bundles
    await waitFor(() => expect(q(".knowledge-bundle-list")).not.toBeNull());

    expect(q(".knowledge-editor-container")).toBeNull();
    expect(q(".knowledge-file-list")).toBeNull();
  });

  it("labels each back control with its destination", async () => {
    mockBundles();
    await openBundle();
    expect(q(".knowledge-back-btn")?.textContent).toContain("Bundles");

    fireEvent.click(q(".knowledge-file-open")!);
    await waitFor(() =>
      expect(q(".knowledge-editor-container")).not.toBeNull(),
    );
    // From the editor, back returns to the bundle's files.
    expect(q(".knowledge-back-btn")?.textContent).toContain("ui-style-guide");
  });

  it("shows the bundle name and file count in the file-list header", async () => {
    mockBundles();
    await openBundle();

    expect(q(".knowledge-drill-title")?.textContent).toBe("ui-style-guide");
    expect(q(".knowledge-drill-count")?.textContent).toContain("2 files");
  });

  it("uses the singular for a one-file bundle", async () => {
    (window as any).hermesAPI = {
      listKnowledgeBundles: vi.fn().mockResolvedValue([
        {
          name: "solo",
          path: "/k/solo",
          files: [{ name: "a.md", path: "/k/solo/a.md" }],
        },
      ]),
      readKnowledgeFile: vi.fn().mockResolvedValue("x"),
    };
    render(<KnowledgeScreen />);
    await screen.findByText("solo");
    fireEvent.click(q(".knowledge-bundle-open")!);
    await waitFor(() => expect(q(".knowledge-drill-count")).not.toBeNull());
    expect(q(".knowledge-drill-count")?.textContent).toBe("1 file");
  });

  it("handles an empty bundle without rendering an empty grid", async () => {
    (window as any).hermesAPI = {
      listKnowledgeBundles: vi
        .fn()
        .mockResolvedValue([{ name: "blank", path: "/k/blank", files: [] }]),
      readKnowledgeFile: vi.fn().mockResolvedValue(""),
    };
    render(<KnowledgeScreen />);
    await screen.findByText("blank");
    fireEvent.click(q(".knowledge-bundle-open")!);

    await waitFor(() => expect(q(".knowledge-drill-empty")).not.toBeNull());
    expect(q(".knowledge-file-list")).toBeNull();
    // Back still works, so an empty bundle is not a dead end.
    fireEvent.click(q(".knowledge-back-btn")!);
    await waitFor(() => expect(q(".knowledge-bundle-list")).not.toBeNull());
  });
});
