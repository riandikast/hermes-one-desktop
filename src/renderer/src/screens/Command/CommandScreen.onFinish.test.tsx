// @vitest-environment jsdom
//
// The Commands page half of On-Finish: a checkbox per row whose checked state
// shows the command's RUN POSITION, and a queue bar that reflects selection
// order. The order is the whole feature, so it is asserted explicitly —
// including that selecting in a non-alphabetical order is preserved.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandScreen } from "./CommandScreen";
import { ON_FINISH_SELECTION_KEY } from "../Chat/onFinish";
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
  {
    id: "m",
    name: "Mango",
    command: "echo m",
    description: "",
    cwd: "",
    folder: "",
    createdAt: 3,
    updatedAt: 3,
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

/** Rows start collapsed; expand Ungrouped so the command rows render. */
async function renderExpanded(): Promise<void> {
  // CommandScreen calls useI18n(), which requires the provider.
  const { container } = render(
    <I18nProvider>
      <CommandScreen />
    </I18nProvider>,
  );
  // The first open collapses EVERY group (including Ungrouped), so the rows
  // only exist after clicking the group header. Target it by class: the header
  // is a button whose title is "Move to Ungrouped", not the group name.
  await waitFor(() =>
    expect(container.querySelector(".command-group-header")).not.toBeNull(),
  );
  fireEvent.click(container.querySelector(".command-group-header")!);
  await waitFor(() =>
    expect(container.querySelectorAll(".command-row").length).toBe(3),
  );
}

function checkboxFor(name: string): HTMLElement {
  return screen.getByLabelText(`Toggle ${name} for On-Finish`);
}

describe("On-Finish selection on the Commands page", () => {
  it("assigns positions in the order the commands were selected", async () => {
    await renderExpanded();

    // Deliberately select in reverse-alphabetical order.
    fireEvent.click(checkboxFor("Zebra"));
    fireEvent.click(checkboxFor("Alpha"));
    fireEvent.click(checkboxFor("Mango"));

    // The numbers on the rows must reflect selection order, not list order.
    await waitFor(() =>
      expect(checkboxFor("Zebra").textContent).toBe("1"),
    );
    expect(checkboxFor("Alpha").textContent).toBe("2");
    expect(checkboxFor("Mango").textContent).toBe("3");
  });

  it("removes a command from the queue and renumbers the rest", async () => {
    await renderExpanded();
    fireEvent.click(checkboxFor("Zebra"));
    fireEvent.click(checkboxFor("Alpha"));
    fireEvent.click(checkboxFor("Mango"));

    // Deselect the middle one: Mango must move up to position 2.
    fireEvent.click(checkboxFor("Alpha"));
    await waitFor(() => expect(checkboxFor("Mango").textContent).toBe("2"));
    expect(checkboxFor("Zebra").textContent).toBe("1");
  });

  it("persists the ordered selection for the chatbox to read", async () => {
    await renderExpanded();
    fireEvent.click(checkboxFor("Mango"));
    fireEvent.click(checkboxFor("Zebra"));

    await waitFor(() => {
      const raw = localStorage.getItem(ON_FINISH_SELECTION_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual([
        { id: "m", order: 0 },
        { id: "z", order: 1 },
      ]);
    });
  });

  it("shows a numbered queue bar listing the run order", async () => {
    await renderExpanded();
    fireEvent.click(checkboxFor("Zebra"));
    fireEvent.click(checkboxFor("Mango"));

    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(2\)/)).toBeDefined(),
    );
    const chips = document.querySelectorAll(".command-onfinish-chip-name");
    expect([...chips].map((c) => c.textContent)).toEqual(["Zebra", "Mango"]);
  });

  it("reorders the queue with the move controls", async () => {
    await renderExpanded();
    fireEvent.click(checkboxFor("Zebra"));
    fireEvent.click(checkboxFor("Mango"));

    // Move Mango earlier: it should become first.
    fireEvent.click(screen.getByLabelText("Move Mango earlier"));
    await waitFor(() => {
      const chips = document.querySelectorAll(".command-onfinish-chip-name");
      expect([...chips].map((c) => c.textContent)).toEqual(["Mango", "Zebra"]);
    });
    // And the row badges follow.
    expect(checkboxFor("Mango").textContent).toBe("1");
    expect(checkboxFor("Zebra").textContent).toBe("2");
  });

  it("clears the whole queue", async () => {
    await renderExpanded();
    fireEvent.click(checkboxFor("Zebra"));
    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(1\)/)).toBeDefined(),
    );

    fireEvent.click(screen.getByTitle("Clear the On-Finish queue"));
    await waitFor(() =>
      expect(screen.queryByText(/On-Finish queue/)).toBeNull(),
    );
  });

  it("restores a saved queue on mount", async () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([
        { id: "m", order: 0 },
        { id: "z", order: 1 },
      ]),
    );
    await renderExpanded();
    await waitFor(() =>
      expect(screen.getByText(/On-Finish queue \(2\)/)).toBeDefined(),
    );
    expect(checkboxFor("Mango").textContent).toBe("1");
    expect(checkboxFor("Zebra").textContent).toBe("2");
  });
});
