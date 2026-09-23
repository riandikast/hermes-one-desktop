// @vitest-environment jsdom
//
// Right-click on the file-list surface must offer "New file in <bundle>" and
// open the inline create bar for THAT bundle — so adding a file no longer
// requires backing out to the bundle grid and clicking its "+".

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const q = <T extends Element>(sel: string): T | null =>
  document.querySelector<T>(sel);

function mockApi(): void {
  (window as any).hermesAPI = {
    listKnowledgeBundles: vi.fn().mockResolvedValue([
      { name: "ui-rules", path: "/k/ui-rules", files: [] },
    ]),
    createKnowledgeBundle: vi.fn().mockResolvedValue(true),
    writeKnowledgeFile: vi.fn().mockResolvedValue(true),
    readKnowledgeFile: vi.fn().mockResolvedValue(""),
  };
}

async function openEmptyBundle(): Promise<void> {
  render(<KnowledgeScreen />);
  await screen.findByText("ui-rules");
  fireEvent.click(q(".knowledge-bundle-card")!);
  await waitFor(() => expect(q(".knowledge-drill-empty")).not.toBeNull());
}

describe("knowledge file-list right-click menu", () => {
  beforeEach(() => {
    mockApi();
    document.body.innerHTML = "";
  });

  it("opens a create-file menu on right-click in an empty bundle", async () => {
    await openEmptyBundle();

    expect(q(".knowledge-context-menu")).toBeNull();
    fireEvent.contextMenu(q(".knowledge-drill-scroll")!, {
      clientX: 120,
      clientY: 80,
    });

    await waitFor(() =>
      expect(q(".knowledge-context-menu")).not.toBeNull(),
    );
    expect(screen.getByText(/New file in/)).toBeTruthy();
  });

  it("the menu action opens the inline create bar for the current bundle", async () => {
    await openEmptyBundle();

    fireEvent.contextMenu(q(".knowledge-drill-scroll")!, {
      clientX: 120,
      clientY: 80,
    });
    await waitFor(() => expect(q(".knowledge-context-menu")).not.toBeNull());
    fireEvent.click(screen.getByText(/New file in/));

    // The create bar appears (no navigation back to the grid) and is focused.
    await waitFor(() => expect(q(".knowledge-add-file-bar")).not.toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        q<HTMLInputElement>(".knowledge-add-file-bar input"),
      ),
    );
    // Still on the file list, not the bundle grid.
    expect(q(".knowledge-bundle-list")).toBeNull();
  });

  it("creates the file and opens it in the editor", async () => {
    await openEmptyBundle();

    fireEvent.contextMenu(q(".knowledge-drill-scroll")!, {
      clientX: 120,
      clientY: 80,
    });
    await waitFor(() => expect(q(".knowledge-context-menu")).not.toBeNull());
    fireEvent.click(screen.getByText(/New file in/));
    await waitFor(() => expect(q(".knowledge-add-file-bar")).not.toBeNull());

    const input = q<HTMLInputElement>(".knowledge-add-file-bar input")!;
    fireEvent.change(input, { target: { value: "notes" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect((window as any).hermesAPI.writeKnowledgeFile).toHaveBeenCalledWith(
        "ui-rules",
        // A bare name gets the .md extension.
        "notes.md",
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(q(".knowledge-editor-container")).not.toBeNull(),
    );
  });

  it("closes the menu on Escape", async () => {
    await openEmptyBundle();
    fireEvent.contextMenu(q(".knowledge-drill-scroll")!, {
      clientX: 10,
      clientY: 10,
    });
    await waitFor(() => expect(q(".knowledge-context-menu")).not.toBeNull());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(q(".knowledge-context-menu")).toBeNull());
  });
});
