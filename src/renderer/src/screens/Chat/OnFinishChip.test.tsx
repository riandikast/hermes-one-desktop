// @vitest-environment jsdom
//
// The On-Finish chip is BOTH the picker and the switch: clicking it opens a
// dropdown of every command (grouped and ungrouped, like the folder chip), and
// ticking commands arms the auto-run. There is no separate arm toggle — an
// armed-but-empty queue is unobservable, and "I ticked things and nothing ran"
// is the failure that ambiguity produces.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnFinishChip } from "./OnFinishChip";
import {
  ON_FINISH_SELECTION_KEY,
  readOnFinishSelection,
  writeOnFinishSelection,
} from "./onFinish";

/** The scope this suite mounts the chip under. */
const SCOPE = "test-scope";

const COMMANDS = [
  {
    id: "z",
    name: "Zebra",
    command: "echo z",
    description: "",
    cwd: "/p",
    folder: "",
  },
  {
    id: "a",
    name: "Alpha",
    command: "echo a",
    description: "",
    cwd: "/p",
    folder: "Build",
  },
  {
    id: "m",
    name: "Mango",
    command: "echo m",
    description: "",
    cwd: "/p",
    folder: "Build",
  },
];

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listCommands: vi.fn().mockResolvedValue(COMMANDS),
  };
});

function chip(): HTMLElement {
  return screen.getByRole("button", { name: /On-Finish/ });
}

async function openDropdown(): Promise<void> {
  render(<OnFinishChip running={false} scope={SCOPE} />);
  fireEvent.click(chip());
  // Wait on a GROUP header, not a command name: groups start collapsed (as on
  // the Commands page), so no command row exists until a group is expanded.
  await waitFor(() => expect(screen.getByText("Ungrouped")).toBeDefined());
}

/** Expand a group so its command rows render. */
async function expandGroup(label: string): Promise<void> {
  fireEvent.click(screen.getByText(label));
  await waitFor(() =>
    expect(document.querySelectorAll(".chat-ctxfolder-dropdown-item").length)
      .toBeGreaterThan(0),
  );
}

function item(name: string): HTMLElement {
  // The dropdown items carry the command name in a span; find the button.
  const spans = [...document.querySelectorAll(".chat-ctxfolder-dropdown-item-name")];
  const span = spans.find((el) => el.textContent === name);
  if (!span) throw new Error(`no dropdown item named ${name}`);
  return span.closest("button")!;
}

describe("On-Finish chip", () => {
  it("opens a dropdown listing commands grouped AND ungrouped", async () => {
    await openDropdown();

    // Ungrouped is expanded by default? No — groups start collapsed, matching
    // the Commands page, so both group headers must be present.
    expect(screen.getByText("Ungrouped")).toBeDefined();
    expect(screen.getByText("Build")).toBeDefined();
  });

  it("shows every command once its group is expanded", async () => {
    await openDropdown();
    // Expand the folder group (Ungrouped is a separate header).
    fireEvent.click(screen.getByText("Build"));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeDefined());
    expect(screen.getByText("Mango")).toBeDefined();

    fireEvent.click(screen.getByText("Ungrouped"));
    await waitFor(() => expect(screen.getByText("Zebra")).toBeDefined());
  });

  it("arms on the first tick and shows the count on the chip", async () => {
    await openDropdown();
    await expandGroup("Ungrouped");
    fireEvent.click(item("Zebra"));

    await waitFor(() => expect(chip().textContent).toContain("On-Finish (1)"));
    expect(readOnFinishSelection(SCOPE)).toEqual(["z"]);
  });

  it("numbers the queue by selection order, first picked runs first", async () => {
    await openDropdown();
    await expandGroup("Ungrouped");
    await expandGroup("Build");

    // Pick Zebra then Alpha: Alpha must be #2 even though it sorts first.
    fireEvent.click(item("Zebra"));
    fireEvent.click(item("Alpha"));

    await waitFor(() =>
      expect(readOnFinishSelection(SCOPE)).toEqual(["z", "a"]),
    );
    const indices = [...document.querySelectorAll(".chat-onfinish-item-order")];
    expect(indices.map((el) => el.textContent).sort()).toEqual(["1", "2"]);
  });

  it("shows the queue in run order at the top of the dropdown", async () => {
    writeOnFinishSelection(["z", "a"], SCOPE);
    await openDropdown();

    const queueChips = document.querySelectorAll(".chat-onfinish-queue-name");
    expect([...queueChips].map((el) => el.textContent)).toEqual([
      "Zebra",
      "Alpha",
    ]);
  });

  it("deselecting the last command disarms (chip loses its count)", async () => {
    await openDropdown();
    await expandGroup("Ungrouped");
    fireEvent.click(item("Zebra"));
    await waitFor(() => expect(chip().textContent).toContain("On-Finish (1)"));

    fireEvent.click(item("Zebra"));

    await waitFor(() => expect(chip().textContent).toBe("On-Finish"));
    expect(readOnFinishSelection(SCOPE)).toEqual([]);
  });

  it("persists across a remount", async () => {
    writeOnFinishSelection(["a", "z"], SCOPE);
    render(<OnFinishChip running={false} scope={SCOPE} />);
    await waitFor(() => expect(chip().textContent).toContain("On-Finish (2)"));
  });

  it("clears the queue from the dropdown footer", async () => {
    writeOnFinishSelection(["a", "z"], SCOPE);
    await openDropdown();

    fireEvent.click(screen.getByText(/Clear queue/));

    await waitFor(() => expect(readOnFinishSelection(SCOPE)).toEqual([]));
    expect(chip().textContent).toBe("On-Finish");
  });

  it("shows a busy label while the queue is running", () => {
    writeOnFinishSelection(["a"], SCOPE);
    render(<OnFinishChip running={true} scope={SCOPE} />);
    expect(chip().textContent).toContain("On-Finish (1)…");
  });

  it("handles no saved commands without throwing", async () => {
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      listCommands: vi.fn().mockResolvedValue([]),
    };
    // Cannot use openDropdown() here: it waits on a group header, and with no
    // commands there are no groups at all.
    render(<OnFinishChip running={false} scope={SCOPE} />);
    fireEvent.click(chip());
    await waitFor(() =>
      expect(screen.getByText("No saved commands yet")).toBeDefined(),
    );
  });

  it("labels a deleted command in the queue instead of dropping a slot", async () => {
    writeOnFinishSelection(["gone", "a"], SCOPE);
    await openDropdown();
    expect(screen.getByText("(deleted)")).toBeDefined();
  });

  it("writes the storage key the chat reads", async () => {
    await openDropdown();
    await expandGroup("Ungrouped");
    fireEvent.click(item("Zebra"));

    await waitFor(() =>
      expect(localStorage.getItem(`${ON_FINISH_SELECTION_KEY}.test-scope`)).toBeTruthy(),
    );
    expect(readOnFinishSelection(SCOPE)).toEqual(["z"]);
  });
});
