import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BranchDialog } from "./BranchDialog";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("confirms local branch commands, names merge direction, and refreshes after writes", async () => {
  const list = vi.fn().mockResolvedValue({ ok: true, current: "main", branches: [
    { name: "main", current: true, checkedOut: true },
    { name: "feature", current: false, checkedOut: false },
  ] });
  const change = vi.fn().mockResolvedValue({ ok: true, output: "done" });
  Object.assign(window, { hermesAPI: { gitBranches: list, gitBranchChange: change } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={changed} />);
  expect(await screen.findByRole("button", { name: "Checkout main" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete main" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Checkout feature" }));
  expect(change).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Checkout feature" })).toBeEnabled());
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Merge feature into main" }));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("Merge “feature” INTO “main”"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(change).toHaveBeenLastCalledWith("/repo", "merge", "feature", "main");
  expect(list).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByRole("button", { name: "Create branch" })).toBeDisabled());
  fireEvent.change(screen.getByLabelText("New branch name"), { target: { value: "new-feature" } });
  fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
  await waitFor(() => expect(change).toHaveBeenLastCalledWith("/repo", "create", "new-feature", "main"));
  await waitFor(() => expect(screen.getByLabelText("New branch name")).toHaveValue(""));
});

it("shows remote URLs, names distinct push targets, and keeps the branch input editable", async () => {
  Object.assign(window, { hermesAPI: { gitBranches: vi.fn().mockResolvedValue({ ok: true, current: "main", branches: [], remotes: [
    { name: "origin", fetchUrls: ["https://example.invalid/repo.git"], pushUrls: ["git@example.invalid:push.git"] },
  ] }), gitBranchChange: vi.fn() } });
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByText("https://example.invalid/repo.git")).toBeTruthy();
  expect(screen.getByText("git@example.invalid:push.git")).toBeTruthy();
  const input = screen.getByLabelText("New branch name"); input.focus();
  fireEvent.change(input, { target: { value: "feature/test" } });
  expect(input).toHaveFocus(); expect(input).toHaveValue("feature/test");
});

it("keeps command failures visible and blocks duplicate clicks", async () => {
  let finish!: (value: { ok: boolean; error: string }) => void;
  const change = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  Object.assign(window, { hermesAPI: { gitBranches: vi.fn().mockResolvedValue({ ok: true, current: "main", branches: [{ name: "other", current: false, checkedOut: false }] }), gitBranchChange: change } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Delete other" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
  finish({ ok: false, error: "not fully merged" });
  expect(await screen.findByRole("alert")).toHaveTextContent("not fully merged");
});
