import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import ShortcutsPane from "./ShortcutsPane";
import { saveKeyboardShortcuts } from "../../utils/keyboardShortcuts";

let saved: Record<string, string[]> = {};
const getKeyboardShortcuts = vi.fn(async () => saved);
const setKeyboardShortcuts = vi.fn(async (value: Record<string, string[]>): Promise<{ ok: boolean; error?: string }> => {
  saved = value;
  return { ok: true };
});
const setShortcutRecording = vi.fn(async () => undefined);

beforeEach(async () => {
  saved = {};
  vi.clearAllMocks();
  Object.assign(window, {
    hermesAPI: { getKeyboardShortcuts, setKeyboardShortcuts, setShortcutRecording },
  });
  await saveKeyboardShortcuts({});
});

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest<HTMLElement>(".settings-shortcut-row");
  if (!row) throw new Error(`Missing shortcut row for ${label}`);
  return row;
}

it("lists every shortcut and persists a recorded chord", async () => {
  renderWithI18n(<ShortcutsPane />);
  expect(screen.getByRole("heading", { name: /Keyboard shortcuts/i })).toBeTruthy();
  expect(screen.getByText("Toggle terminal")).toBeTruthy();
  const row = rowFor("Toggle terminal");
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  expect(setShortcutRecording).toHaveBeenCalledWith(true);
  fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({ toggleTerminal: ["Mod+Shift+K"] })));
  await waitFor(() => expect(setShortcutRecording).toHaveBeenLastCalledWith(false));
  expect(within(row).getByText("Ctrl+Shift+K")).toBeTruthy();
});

it("rejects a bare letter and a conflicting chord without saving", async () => {
  renderWithI18n(<ShortcutsPane />);
  const savesBefore = setKeyboardShortcuts.mock.calls.length;
  const row = rowFor("Toggle terminal");
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  fireEvent.keyDown(window, { key: "k", ctrlKey: false });
  expect(await screen.findByRole("alert")).toHaveTextContent(/Add a modifier/);
  // Ctrl+F is already taken by file search, so it must not be accepted.
  fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent(/Search file names already uses Ctrl\+F/);
  expect(setKeyboardShortcuts).toHaveBeenCalledTimes(savesBefore);
});

it("cancels with Escape and restores a customised row to its default", async () => {
  saved = { toggleTerminal: ["Mod+J"] };
  await saveKeyboardShortcuts({ toggleTerminal: ["Mod+J"] });
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Toggle terminal");
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(setShortcutRecording).toHaveBeenLastCalledWith(false));
  expect(within(row).getByText("Ctrl+J")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: /Restore default for Toggle terminal/i }));
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenLastCalledWith({}));
  expect(within(row).getAllByText("Ctrl+T").length).toBeGreaterThan(0);
});

it("clears a binding with Backspace so the command becomes unassigned", async () => {
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Close tab");
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  fireEvent.keyDown(window, { key: "Backspace" });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({ closeTab: [] })));
  expect(within(row).getByText("Unassigned")).toBeTruthy();
});

it("edits one chord of a multi-shortcut action without dropping the others", async () => {
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Zoom in");
  expect(within(row).getAllByRole("button", { name: /^Change shortcut/ })).toHaveLength(2);
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  fireEvent.keyDown(window, { key: "u", ctrlKey: true, altKey: true });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({ zoomIn: ["Mod+Alt+U", "Mod+="] })));
  expect(within(row).getByText("Ctrl+=")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "Change shortcut Ctrl+= for Zoom in" }));
  fireEvent.keyDown(window, { key: "y", ctrlKey: true, altKey: true });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ zoomIn: ["Mod+Alt+U", "Mod+Alt+Y"] })));
});

it("appends a chord and refuses one the same action already uses", async () => {
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Zoom in");
  fireEvent.click(within(row).getByRole("button", { name: "Add shortcut for Zoom in" }));
  const savesBefore = setKeyboardShortcuts.mock.calls.length;
  fireEvent.keyDown(window, { key: "=", ctrlKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("Zoom in already uses Ctrl+=");
  expect(setKeyboardShortcuts).toHaveBeenCalledTimes(savesBefore);
  fireEvent.keyDown(window, { key: "u", ctrlKey: true, altKey: true });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({ zoomIn: ["Mod+Plus", "Mod+=", "Mod+Alt+U"] })));
});

it("removes only the edited chord with Backspace", async () => {
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Zoom in");
  fireEvent.click(within(row).getByRole("button", { name: "Change shortcut Ctrl+= for Zoom in" }));
  fireEvent.keyDown(window, { key: "Backspace" });
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenCalledWith(expect.objectContaining({ zoomIn: ["Mod+Plus"] })));
  expect(within(row).getByText("Ctrl+Plus")).toBeTruthy();
});

it("removes a single chord with its × button and shows Unassigned when none remain", async () => {
  saved = { zoomIn: ["Mod+Plus", "Mod+=", "Mod+Alt+U"] };
  await saveKeyboardShortcuts(saved);
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Zoom in");
  fireEvent.click(within(row).getByRole("button", { name: "Remove shortcut Ctrl+Alt+U for Zoom in" }));
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ zoomIn: ["Mod+Plus", "Mod+="] })));
  fireEvent.click(within(row).getByRole("button", { name: "Remove shortcut Ctrl+= for Zoom in" }));
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ zoomIn: ["Mod+Plus"] })));
  fireEvent.click(within(row).getByRole("button", { name: "Remove shortcut Ctrl+Plus for Zoom in" }));
  await waitFor(() => expect(setKeyboardShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ zoomIn: [] })));
  expect(within(row).getByText("Unassigned")).toBeTruthy();
});

it("reports a save failure instead of pretending the chord changed", async () => {
  setKeyboardShortcuts.mockResolvedValueOnce({ ok: false, error: "Could not save keyboard shortcuts." } );
  renderWithI18n(<ShortcutsPane />);
  const row = rowFor("Toggle terminal");
  fireEvent.click(within(row).getByRole("button", { name: "Change" }));
  fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save keyboard shortcuts.");
  // A failed write must not look applied: the row stays in capture mode.
  expect(within(row).getByText("Press keys…")).toBeTruthy();
});
