// @vitest-environment jsdom
//
// The Commands page no longer EDITS the On-Finish queue — the chat's On-Finish
// chip does. These assert the page only MIRRORS it (read-only), because two
// editable surfaces for one ordered list is how an order silently diverges.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandScreen } from "./CommandScreen";
import {
  ON_FINISH_CHANGE_EVENT,
  ON_FINISH_SELECTION_KEY,
  writeOnFinishSelection,
} from "../Chat/onFinish";
import { I18nProvider } from "../../components/I18nProvider";

const COMMANDS = [
  {
    id: "z",
    name: "Zebra",
    command: "echo z",
    description: "",
    cwd: "",
    folder: "",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "a",
    name: "Alpha",
    command: "echo a",
    description: "",
    cwd: "",
    folder: "",
    createdAt: 2,
    updatedAt: 2,
  },
];

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listCommands: vi.fn().mockResolvedValue(COMMANDS),
    saveCommand: vi.fn(),
    deleteCommand: vi.fn(),
    selectFolder: vi.fn(),
    commandRun: vi.fn().mockResolvedValue({ id: "term-1" }),
    commandRunOs: vi.fn().mockResolvedValue({ ok: true }),
    terminalCreate: vi.fn().mockResolvedValue({ id: "t1" }),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalKill: vi.fn(),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
  };
});

async function renderExpanded(): Promise<void> {
  const { container } = render(
    <I18nProvider>
      <CommandScreen />
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(container.querySelector(".command-group-header")).not.toBeNull(),
  );
  fireEvent.click(container.querySelector(".command-group-header")!);
  await waitFor(() =>
    expect(container.querySelectorAll(".command-row").length).toBe(2),
  );
}

describe("Commands page mirrors the On-Finish queue", () => {
  it("shows no queue bar when the queue is empty", async () => {
    await renderExpanded();
    expect(screen.queryByText(/On-Finish queue/)).toBeNull();
  });

  it("mirrors a queue set from the chat, in order", async () => {
    writeOnFinishSelection(["a", "z"]);
    await renderExpanded();

    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(2\)/)).toBeDefined(),
    );
    // Order must come from the selection, not the command list.
    const chips = document.querySelectorAll(".command-onfinish-chip-name");
    expect([...chips].map((c) => c.textContent)).toEqual(["Alpha", "Zebra"]);
  });

  it("offers no editing controls — the chat chip owns the queue", async () => {
    writeOnFinishSelection(["a"]);
    await renderExpanded();
    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(1\)/)).toBeDefined(),
    );

    // No checkboxes, no clear button, no reorder buttons on this page.
    expect(document.querySelectorAll(".command-row-check").length).toBe(0);
    expect(screen.queryByTitle("Clear the On-Finish queue")).toBeNull();
    expect(screen.queryByLabelText(/Move .* earlier/)).toBeNull();
  });

  it("updates live when the queue changes elsewhere", async () => {
    await renderExpanded();
    expect(screen.queryByText(/On-Finish queue/)).toBeNull();

    // Simulate the chip writing a new queue while this page is open.
    writeOnFinishSelection(["z", "a"]);

    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(2\)/)).toBeDefined(),
    );
    const chips = document.querySelectorAll(".command-onfinish-chip-name");
    expect([...chips].map((c) => c.textContent)).toEqual(["Zebra", "Alpha"]);
  });

  it("drops the bar when the queue is cleared", async () => {
    writeOnFinishSelection(["a"]);
    await renderExpanded();
    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(1\)/)).toBeDefined(),
    );

    writeOnFinishSelection([]);
    await waitFor(() => expect(screen.queryByText(/On-Finish queue/)).toBeNull());
  });

  it("labels a command deleted from the queue rather than dropping a slot", async () => {
    writeOnFinishSelection(["gone", "a"]);
    await renderExpanded();
    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(2\)/)).toBeDefined(),
    );
    expect(screen.getByText("(deleted)")).toBeDefined();
  });

  it("announces changes on the shared event name", async () => {
    // Guards against a typo in the event string breaking live sync silently.
    const seen: string[] = [];
    const listener = (): void => {
      seen.push("fired");
    };
    window.addEventListener(ON_FINISH_CHANGE_EVENT, listener);
    try {
      writeOnFinishSelection(["a"]);
    } finally {
      window.removeEventListener(ON_FINISH_CHANGE_EVENT, listener);
    }
    expect(seen).toEqual(["fired"]);
    expect(localStorage.getItem(`${ON_FINISH_SELECTION_KEY}.default`)).toBeTruthy();
  });
});
