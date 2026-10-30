import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { StashSection } from "./StashSection";

const entries = [0, 1, 2].map((index) => ({
  hash: String(index + 1).repeat(40),
  ref: `stash@{${index}}`,
  subject: `saved ${index}`,
}));
const list = vi.fn();
const apply = vi.fn();
const drop = vi.fn();
const diff = vi.fn();
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
  list.mockReset().mockResolvedValue({ ok: true, entries });
  apply.mockReset().mockResolvedValue({ ok: true });
  drop.mockReset().mockResolvedValue({ ok: true });
  diff.mockReset().mockResolvedValue({ ok: true, output: "stash diff" });
  run.mockClear();
  preview.mockClear();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    gitStashList: list,
    gitStashApply: apply,
    gitStashDrop: drop,
    gitStashDiff: diff,
  };
});

describe("StashSection", () => {
  it("matches section styling, supports checkbox and row Shift ranges, previews without selecting", async () => {
    render(<StashSection {...props} />);
    const first = await screen.findByLabelText("Select stash@{0}");
    expect(first.closest("details")).toHaveClass("source-control-section");
    fireEvent.click(first);
    fireEvent.click(
      screen.getByRole("button", { name: "stash@{2}: saved 2" }),
      { shiftKey: true },
    );
    for (const entry of entries)
      expect(screen.getByLabelText(`Select ${entry.ref}`)).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear stash selection" }),
    );
    fireEvent.click(screen.getByLabelText("Select stash@{0}"));
    fireEvent.click(screen.getByLabelText("Select stash@{2}"), {
      shiftKey: true,
    });
    expect(
      screen.getByRole("button", { name: "Apply selected (3)" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View stash@{1}" }));
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith("stash diff", "stash@{1}"),
    );
    expect(diff).toHaveBeenCalledWith("/repo", entries[1].hash);
  });
  it("applies in selection order, preserves stashes, confirms drop and cancellation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{2}"));
    fireEvent.click(screen.getByLabelText("Select stash@{0}"));
    fireEvent.click(screen.getByRole("button", { name: "Drop selected (2)" }));
    expect(drop).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply selected (2)" }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith("/repo", [
        entries[2].hash,
        entries[0].hash,
      ]),
    );
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Stashes are kept"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Drop selected (2)" }));
    await waitFor(() =>
      expect(drop).toHaveBeenCalledWith("/repo", [
        entries[2].hash,
        entries[0].hash,
      ]),
    );
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("cannot be undone"),
    );
  });
  it("prunes vanished selections by hash after refs renumber and disables actions while busy", async () => {
    const view = render(<StashSection {...props} />);
    fireEvent.click(await screen.findByLabelText("Select stash@{0}"));
    fireEvent.click(screen.getByLabelText("Select stash@{1}"));
    list.mockResolvedValue({
      ok: true,
      entries: [{ ...entries[1], ref: "stash@{0}" }],
    });
    view.rerender(<StashSection {...props} revision={1} busy />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Apply selected (1)" }),
      ).toBeDisabled(),
    );
    expect(screen.getByLabelText("Select stash@{0}")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Drop stash@{0}" }),
    ).toBeDisabled();
  });
  it("shows loading, empty and rejected API states without losing the section", async () => {
    let resolve!: (value: { ok: boolean; entries: never[] }) => void;
    list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<StashSection {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading stashes");
    await act(async () => resolve({ ok: true, entries: [] }));
    expect(screen.getByText("No stashes")).toBeTruthy();
    list.mockRejectedValue(new Error("list failed"));
    view.rerender(<StashSection {...props} revision={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("list failed");
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
      await screen.findByRole("button", { name: "View stash@{0}" }),
    );
    view.unmount();
    await act(async () => resolve({ ok: true, output: "late" }));
    expect(preview).not.toHaveBeenCalled();
  });
});
