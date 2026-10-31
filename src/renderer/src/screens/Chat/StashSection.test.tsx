import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { StashSection } from "./StashSection";

const entries = [0, 1].map((index) => ({
  hash: String(index + 1).repeat(40),
  ref: `stash@{${index}}`,
  subject: `On custom: saved ${index}`,
}));
const files = [
  { path: "src/a.ts", status: "M" },
  { path: "b.ts", status: "D" },
  { path: "c.ts", status: "A" },
];
const list = vi.fn(),
  fileList = vi.fn(),
  restore = vi.fn(),
  remove = vi.fn(),
  diff = vi.fn();
const run = vi.fn(
  async (action: () => Promise<{ ok: boolean }>): Promise<void> => {
    await action();
  },
);
const preview = vi.fn();
const props = {
  dir: "/repo",
  revision: 0,
  busy: false,
  run,
  onPreview: preview,
};
beforeEach(() => {
  vi.restoreAllMocks();
  list.mockReset().mockResolvedValue({ ok: true, entries: [entries[0]] });
  fileList.mockReset().mockResolvedValue({ ok: true, files });
  restore.mockReset().mockResolvedValue({ ok: true });
  remove.mockReset().mockResolvedValue({ ok: true });
  diff.mockReset().mockResolvedValue({ ok: true, output: "file diff" });
  run.mockClear();
  preview.mockClear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    gitStashList: list,
    gitStashFiles: fileList,
    gitStashRestoreFiles: restore,
    gitStashDeleteFiles: remove,
    gitStashFileDiff: diff,
  };
});

describe("StashSection file rows", () => {
  it("shows filenames not stash messages, matching Staged styling and file status", async () => {
    render(<StashSection {...props} />);
    const first = await screen.findByLabelText("Select stash@{0}: src/a.ts");
    expect(first.closest("details")).toHaveClass("source-control-section");
    expect(screen.getByText("Stash (3)")).toBeTruthy();
    expect(screen.getByText("a.ts")).toHaveClass("source-control-file-name");
    expect(screen.queryByText("On custom: saved 0")).toBeNull();
    expect(screen.getByTitle("Deleted")).toHaveTextContent("D");
    fireEvent.click(screen.getByRole("button", { name: "a.ts M" }));
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith("file diff", "src/a.ts"),
    );
    expect(diff).toHaveBeenCalledWith("/repo", entries[0].hash, "src/a.ts");
    expect(first).not.toBeChecked();
  });
  it("supports checkbox and row Shift ranges within the displayed file group", async () => {
    render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{0}: src/a.ts"));
    fireEvent.click(screen.getByRole("button", { name: "c.ts A" }), {
      shiftKey: true,
    });
    for (const file of files)
      expect(
        screen.getByLabelText(`Select stash@{0}: ${file.path}`),
      ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear stash selection" }),
    );
    fireEvent.click(screen.getByLabelText("Select stash@{0}: src/a.ts"));
    fireEvent.click(screen.getByLabelText("Select stash@{0}: c.ts"), {
      shiftKey: true,
    });
    expect(
      screen.getByRole("button", { name: "Restore selected (3)" }),
    ).toBeEnabled();
  });
  it("restores/deletes selected files only in selection order with confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{0}: c.ts"));
    fireEvent.click(screen.getByLabelText("Select stash@{0}: src/a.ts"));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    expect(remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore selected (2)" }),
    );
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith("/repo", [
        { hash: entries[0].hash, paths: ["c.ts", "src/a.ts"] },
      ]),
    );
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Saved copies are kept"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith("/repo", [
        { hash: entries[0].hash, paths: ["c.ts", "src/a.ts"] },
      ]),
    );
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Other saved files remain"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore stash@{0}: b.ts" }),
    );
    await waitFor(() =>
      expect(restore).toHaveBeenLastCalledWith("/repo", [
        { hash: entries[0].hash, paths: ["b.ts"] },
      ]),
    );
  });
  it("groups multiple stashes, never extends Shift across groups, prunes missing files and disables busy actions", async () => {
    list.mockResolvedValue({ ok: true, entries });
    const view = render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{0}: src/a.ts"));
    fireEvent.click(screen.getByLabelText("Select stash@{1}: c.ts"), {
      shiftKey: true,
    });
    expect(
      screen.getByRole("button", { name: "Restore selected (2)" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Select stash@{1}: b.ts")).not.toBeChecked();
    list.mockResolvedValue({
      ok: true,
      entries: [{ ...entries[1], ref: "stash@{0}" }],
    });
    view.rerender(<StashSection {...props} revision={1} busy />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Restore selected (1)" }),
      ).toBeDisabled(),
    );
    expect(screen.getByLabelText("Select stash@{0}: c.ts")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Delete stash@{0}: c.ts" }),
    ).toBeDisabled();
  });
  it("preserves interleaved file selection order across stash groups", async () => {
    list.mockResolvedValue({ ok: true, entries });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{0}: src/a.ts"));
    fireEvent.click(screen.getByLabelText("Select stash@{1}: b.ts"));
    fireEvent.click(screen.getByLabelText("Select stash@{0}: c.ts"));
    fireEvent.click(
      screen.getByRole("button", { name: "Restore selected (3)" }),
    );
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith("/repo", [
        { hash: entries[0].hash, paths: ["src/a.ts"] },
        { hash: entries[1].hash, paths: ["b.ts"] },
        { hash: entries[0].hash, paths: ["c.ts"] },
      ]),
    );
  });
  it("shows loading, empty and file-list errors", async () => {
    let resolve!: (value: { ok: boolean; entries: never[] }) => void;
    list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<StashSection {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading saved files");
    await act(async () => resolve({ ok: true, entries: [] }));
    expect(screen.getByText("No stashed files")).toBeTruthy();
    list.mockResolvedValue({ ok: true, entries });
    fileList.mockResolvedValue({ ok: false, files: [], error: "files failed" });
    view.rerender(<StashSection {...props} revision={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("files failed");
  });
  it("keeps readable stash files visible when another stash fails, without duplicated Error prefixes", async () => {
    list.mockResolvedValue({ ok: true, entries });
    fileList.mockImplementation(async (_dir: string, hash: string) => hash === entries[0].hash
      ? { ok: false, files: [], error: "Error: Unsupported stash" }
      : { ok: true, files });
    render(<StashSection {...props} />);
    expect(await screen.findByLabelText("Select stash@{1}: src/a.ts")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("stash@{0}: Unsupported stash");
    expect(screen.getByRole("alert").textContent).not.toContain("Error: Error:");
    expect(screen.queryByText("No stashed files")).toBeNull();
  });
  it("ignores a late preview after unmount", async () => {
    let resolve!: (value: { ok: boolean; output: string }) => void;
    diff.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<StashSection {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "View stash@{0}: src/a.ts" }),
    );
    view.unmount();
    await act(async () => resolve({ ok: true, output: "late" }));
    expect(preview).not.toHaveBeenCalled();
  });
});
