// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandScreen } from "./CommandScreen";
import { I18nProvider } from "../../components/I18nProvider";
vi.mock("./TerminalDock", () => ({ TerminalDock: () => null }));
const selectFolder = vi.fn();
const exportCommand = vi.fn();
const commandRun = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(window, { hermesAPI: {
    listCommands: vi.fn().mockResolvedValue([{ id: "one", name: "Demo", command: "echo harmless", description: "", cwd: "", folder: "", createdAt: 1, updatedAt: 1 }]),
    selectFolder, exportCommand, commandRun,
  } });
  selectFolder.mockResolvedValue("C:\\Chosen");
  exportCommand.mockResolvedValue({ path: "C:\\Chosen\\Demo.cmd", shell: "cmd" });
});
afterEach(cleanup);
async function open(): Promise<void> {
  const { container } = render(<I18nProvider><CommandScreen /></I18nProvider>);
  await waitFor(() => expect(container.querySelector(".command-group-header")).not.toBeNull());
  fireEvent.click(container.querySelector(".command-group-header")!);
  fireEvent.click(screen.getByRole("button", { name: "Export Demo as Windows launcher" }));
}
it("exports only the selected template to chosen folder, never executes", async () => {
  await open();
  await waitFor(() => expect(exportCommand).toHaveBeenCalledWith({ id: "one", destination: "C:\\Chosen" }));
  expect(selectFolder).toHaveBeenCalledOnce();
  expect(commandRun).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("no PowerShell required");
});
it("cancellation does not write or execute", async () => {
  selectFolder.mockResolvedValue(null);
  await open();
  await waitFor(() => expect(selectFolder).toHaveBeenCalledOnce());
  expect(exportCommand).not.toHaveBeenCalled();
  expect(commandRun).not.toHaveBeenCalled();
});
it("surfaces save errors and re-enables export", async () => {
  exportCommand.mockRejectedValueOnce(new Error("denied"));
  await open();
  await waitFor(() => expect(screen.getByText(/Failed to export launcher/)).toBeDefined());
  expect((screen.getByRole("button", { name: "Export Demo as Windows launcher" }) as HTMLButtonElement).disabled).toBe(false);
});
it("marks the companion and PowerShell dependency", async () => {
  exportCommand.mockResolvedValueOnce({ path: "C:\\Chosen\\Demo.powershell.cmd", shell: "powershell" });
  await open();
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Requires PowerShell and script permission"));
});
