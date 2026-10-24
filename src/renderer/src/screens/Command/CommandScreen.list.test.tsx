// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { CommandScreen } from "./CommandScreen";


const { attachSession } = vi.hoisted(() => ({ attachSession: vi.fn() }));
vi.mock("./TerminalDock", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    TerminalDock: forwardRef(function Dock(_, ref) {
      useImperativeHandle(ref, () => ({ attachSession }));
      return <div data-testid="terminal-dock" />;
    }),
  };
});
const demo = {
  id: "one",
  name: "Build",
  command: "echo harmless\necho done",
  description: "Compile project",
  cwd: "C:/project",
  folder: "Work",
  createdAt: 1,
  updatedAt: 1,
};
const other = { ...demo, id: "two", name: "Check", folder: "Other" };
const listCommands = vi.fn();
const saveCommand = vi.fn();
const commandRun = vi.fn();
const commandRunOs = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listCommands.mockResolvedValue([demo, other]);
  saveCommand.mockResolvedValue(undefined);
  commandRun.mockResolvedValue({ id: "test-terminal" });
  commandRunOs.mockResolvedValue({ ok: true });
  Object.assign(window, {
    hermesAPI: { listCommands, saveCommand, commandRun, commandRunOs },
  });
});
afterEach(cleanup);
it("keeps command surfaces distinct with readable light and dark tokens", async () => {
  const { readFileSync } = await vi.importActual<{
    readFileSync(path: string, encoding: string): string;
  }>("node:fs");
  const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
  expect(css.length).toBeGreaterThan(1000);
  expect(css.match(/\.command-groups \{([^}]+)\}/)?.[1]).toContain(
    "background: var(--bg-primary)",
  );
  const row = css.match(/\.command-row \{([^}]+)\}/)?.[1];
  expect(row).toContain("background: var(--bg-secondary)");
  expect(row).toContain("border: 1px solid var(--border-color)");
  expect(css.match(/\.command-list \{([^}]+)\}/)?.[1]).toContain("gap: 6px");
  const luminance = (hex: string): number => {
    const rgb = hex
      .match(/\w\w/g)!
      .map((part) => parseInt(part, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const themes = [
    ...css.matchAll(
      /--bg-primary: (#[\da-f]{6});\s*--bg-secondary: (#[\da-f]{6});([\s\S]*?)--text-primary: (#[\da-f]{6});\s*--text-secondary: (#[\da-f]{6});/g,
    ),
  ];
  expect(themes.length).toBeGreaterThanOrEqual(2);
  // Default dark and light palettes; custom themes remain user-controlled.
  for (const [, page, surface, , primary, secondary] of themes.slice(0, 2)) {
    expect(surface).not.toBe(page);
    for (const text of [primary, secondary]) {
      const a = luminance(text.slice(1));
      const b = luminance(surface.slice(1));
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
function open() {
  return render(
    <I18nProvider>
      <CommandScreen />
    </I18nProvider>,
  );
}
async function expand() {
  const header = await screen.findByRole("button", { name: "Work 1" });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(header);
  return screen.getByRole("list", { name: "Work commands" });
}

// @lat: [[commands-terminal#Commands store + built-in terminal#Compact command list]]
it("renders named semantic rows with trailing working actions and collapsible groups", async () => {
  open();
  const list = await expand();
  const row = within(list).getAllByRole("listitem")[0];
  expect(row.firstElementChild?.className).toBe("command-row-body");
  expect(row.querySelector("code")?.textContent).toBe(demo.command);
  expect(row.querySelector("code")?.title).toBe(demo.command);
  expect(within(row).getAllByText(`cwd: ${demo.cwd}`)).toHaveLength(1);
  const actions = within(row).getByRole("group", { name: "Build actions" });
  expect(within(actions).getAllByRole("button")).toHaveLength(6);
  fireEvent.click(
    within(actions).getByRole("button", { name: "Run Build" }),
  );
  await waitFor(() =>
    expect(attachSession).toHaveBeenCalledWith(
      "test-terminal",
      "Build",
      demo.cwd,
    ),
  );
  fireEvent.click(
    within(actions).getByRole("button", { name: "Run Build in OS terminal" }),
  );
  await waitFor(() =>
    expect(commandRunOs).toHaveBeenCalledWith({
      commandId: demo.id,
      cwd: demo.cwd,
      command: demo.command,
    }),
  );
  fireEvent.click(within(actions).getByRole("button", { name: "Duplicate" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Build (copy)",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(within(actions).getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Build",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(within(actions).getByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete command?")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Work 1" }));
  expect(screen.queryByRole("list", { name: "Work commands" })).toBeNull();
  expect(screen.getByTestId("terminal-dock")).toBeDefined();
});

it("keeps drag-to-group persistence and command-text search", async () => {
  const { container } = open();
  await expand();
  const dataTransfer = { effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(container.querySelector(".command-row")!, {
    dataTransfer,
  });
  fireEvent.drop(screen.getByRole("button", { name: "Other 1" }), {
    dataTransfer,
  });
  await waitFor(() =>
    expect(saveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: demo.id, folder: "Other" }),
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "not present" },
  });
  expect(screen.getByText(/No commands match/)).toBeDefined();
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "echo harmless" },
  });
  expect(screen.getByRole("list", { name: "Work commands" })).toBeDefined();
});

it("distinguishes loading, empty and failed loading", async () => {
  listCommands.mockReturnValueOnce(new Promise(() => {}));
  const view = open();
  expect(screen.getByRole("status").textContent).toBe("Loading commands…");
  view.unmount();
  listCommands.mockResolvedValueOnce([]);
  const empty = open();
  expect(await screen.findByText("No commands saved yet.")).toBeDefined();
  empty.unmount();
  listCommands.mockRejectedValueOnce(new Error("unavailable"));
  open();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Failed to load commands.",
  );
});
