import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BranchDialog } from "./BranchDialog";

const initial = {
  ok: true, current: "main",
  branches: [{ name: "main", current: true, checkedOut: true, upstream: null as string | null }],
  remotes: [{ name: "master", fetchUrls: ["https://example.invalid/repo.git"], pushUrls: ["https://example.invalid/push.git"], pushFingerprint: "fixture-fingerprint" }],
  remoteBranches: [{ remote: "master", name: "main" }],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("renames a remote only after confirmation, then reloads the exact repository", async () => {
  const list = vi.fn().mockResolvedValue(initial);
  const rename = vi.fn().mockResolvedValue({ ok: true });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  Object.assign(window, { hermesAPI: { gitBranches: list, gitRemoteRename: rename } });
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={changed} />);
  fireEvent.click(await screen.findByRole("button", { name: "Rename remote master" }));
  fireEvent.change(screen.getByLabelText("New remote name"), { target: { value: "origin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save remote name" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save remote name" })).toBeEnabled());
  expect(rename).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Save remote name" }));
  await waitFor(() => expect(rename).toHaveBeenCalledWith("/repo", "master", "origin"));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("No fetch or push"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(list).toHaveBeenCalledTimes(2);
});

it("separates local tracking from publishing, confirms destination and refreshes tracking", async () => {
  const list = vi.fn().mockResolvedValue(initial);
  const upstream = vi.fn().mockResolvedValue({ ok: true });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  Object.assign(window, { hermesAPI: { gitBranches: list, gitBranchUpstream: upstream } });
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByText("No upstream branch configured.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Publish and set upstream" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Upstream remote"), { target: { value: "master" } });
  expect(screen.getByLabelText("Remote branch")).toHaveValue("main");
  fireEvent.click(screen.getByRole("button", { name: "Set upstream" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Set upstream" })).toBeEnabled());
  expect(upstream).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  list.mockResolvedValue({ ...initial, branches: [{ ...initial.branches[0], upstream: "master/main" }] });
  fireEvent.click(screen.getByRole("button", { name: "Set upstream" }));
  await waitFor(() => expect(upstream).toHaveBeenLastCalledWith("/repo", "set", "main", "master", "main", "fixture-fingerprint"));
  expect(await screen.findByText("Tracking: master/main")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Unset upstream" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Unset upstream" }));
  await waitFor(() => expect(upstream).toHaveBeenLastCalledWith("/repo", "unset", "main", "master", "main", "fixture-fingerprint"));
  await waitFor(() => expect(screen.getByLabelText("Remote branch")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Remote branch"), { target: { value: "feature/new" } });
  expect(screen.getByRole("button", { name: "Set upstream" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Publish and set upstream" }));
  await waitFor(() => expect(upstream).toHaveBeenLastCalledWith("/repo", "publish", "main", "master", "feature/new", "fixture-fingerprint"));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("master/feature/new” at https://example.invalid/push.git"));
});

it("preserves failures, prevents duplicate submissions and disables detached HEAD", async () => {
  let finish!: (value: { ok: boolean; error: string }) => void;
  const upstream = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const list = vi.fn().mockResolvedValue(initial);
  Object.assign(window, { hermesAPI: { gitBranches: list, gitBranchUpstream: upstream } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const view = render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByText("No upstream branch configured.");
  fireEvent.change(screen.getByLabelText("Upstream remote"), { target: { value: "master" } });
  const button = screen.getByRole("button", { name: "Publish and set upstream" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
  finish({ ok: false, error: "Push rejected" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Push rejected");
  view.unmount();
  list.mockResolvedValue({ ...initial, current: null, branches: [] });
  render(<BranchDialog dir="/repo" onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(await screen.findByLabelText("Upstream remote")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Publish and set upstream" })).toBeDisabled();
});
