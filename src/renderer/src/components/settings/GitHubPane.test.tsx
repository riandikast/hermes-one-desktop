import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import GitHubPane from "./GitHubPane";
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const status: Awaited<ReturnType<typeof window.hermesAPI.githubAuthStatus>> = { git: true, manager: true, helper: false, auth: "unknown" };
beforeEach(() => {
  Object.assign(window, { hermesAPI: {
    githubAuthStatus: vi.fn().mockResolvedValue(status),
    githubAuthSignIn: vi.fn().mockResolvedValue({ ...status, helper: true, auth: "authenticated", account: "octocat" }),
    githubAuthSelectAccount: vi.fn().mockResolvedValue({ ...status, accounts: ["first", "second"], selectedAccount: "second", account: "second", auth: "authenticated" }),
    githubAuthCancel: vi.fn().mockResolvedValue(undefined),
  } });
});
it("shows a loading skeleton until the first status resolves", async () => {
  let finish!: (value: typeof status) => void;
  vi.mocked(window.hermesAPI.githubAuthStatus).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const { container } = render(<GitHubPane />);
  // The pane used to render an empty box while status resolved.
  expect(container.querySelector(".github-skeleton-line")).not.toBeNull();
  await act(async () => finish(status));
  await screen.findByRole("status");
  expect(container.querySelector(".github-skeleton-line")).toBeNull();
});
it("checks status automatically but signs in only after a click", async () => {
  render(<GitHubPane />);
  await screen.findByText("settings.github.unknown");
  expect(window.hermesAPI.githubAuthSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("settings.github.signIn"));
  // Account and state are separate elements now, so the identity renders
  // without the old "(account)" suffix baked into one status string.
  await screen.findByText("octocat");
  expect(screen.getByText("settings.github.authenticated")).toBeInTheDocument();
  fireEvent.click(screen.getByText("settings.github.verify"));
  await waitFor(() => expect(window.hermesAPI.githubAuthStatus).toHaveBeenCalledTimes(2));
});
it("selects a saved account only after user input, then displays the persisted pin", async () => {
  vi.mocked(window.hermesAPI.githubAuthStatus).mockResolvedValue({ ...status, accounts: ["first", "second"] });
  render(<GitHubPane />);
  await screen.findByText("settings.github.unknown");
  expect(window.hermesAPI.githubAuthSelectAccount).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "second" } });
  await screen.findByText("settings.github.authenticated");
  expect(window.hermesAPI.githubAuthSelectAccount).toHaveBeenCalledWith("second");
  expect(screen.getByRole("combobox")).toHaveValue("second");
  // The chosen account must be readable, not merely present in the control.
  expect(screen.getAllByText("second").length).toBeGreaterThan(0);
});
it("shows errors and disables sign-in without native manager", async () => {
  vi.mocked(window.hermesAPI.githubAuthStatus).mockRejectedValueOnce(new Error("IPC unavailable"));
  render(<GitHubPane />);
  await screen.findByRole("alert");
  expect(screen.getByText("settings.github.signIn")).toBeDisabled();
});
it("renders the error inside the status card, not as bare text", async () => {
  vi.mocked(window.hermesAPI.githubAuthStatus).mockResolvedValueOnce({ ...status, error: "timeout" });
  render(<GitHubPane />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("settings.github.timeout");
  expect(alert.className).toContain("github-alert");
});
it("disconnects only after an explicit confirmation", async () => {
  vi.mocked(window.hermesAPI.githubAuthStatus).mockResolvedValue({
    ...status, accounts: ["first", "second"], selectedAccount: "second", account: "second", auth: "authenticated",
  });
  Object.assign(window.hermesAPI, {
    githubAuthDisconnect: vi.fn().mockResolvedValue({ ...status, accounts: ["first"], selectedAccount: undefined, auth: "unknown" }),
  });
  render(<GitHubPane />);
  await screen.findByText("settings.github.authenticated");
  // Clicking Disconnect must ask first — this deletes a stored credential.
  fireEvent.click(screen.getByText("settings.github.disconnect"));
  expect(window.hermesAPI.githubAuthDisconnect).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("settings.github.confirming");

  // Cancelling leaves the account alone.
  fireEvent.click(screen.getByText("common.cancel"));
  expect(window.hermesAPI.githubAuthDisconnect).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();

  fireEvent.click(screen.getByText("settings.github.disconnect"));
  fireEvent.click(screen.getByRole("alertdialog").querySelector(".github-disconnect")!);
  await waitFor(() => expect(window.hermesAPI.githubAuthDisconnect).toHaveBeenCalledWith("second"));
  expect(window.hermesAPI.githubAuthDisconnect).toHaveBeenCalledTimes(1);
});
it("offers no disconnect control when no account is selected", async () => {
  render(<GitHubPane />);
  await screen.findByText("settings.github.unknown");
  expect(screen.queryByText("settings.github.disconnect")).toBeNull();
});
it("cancels pending sign-in and cleans up when leaving settings", async () => {
  let finish!: (value: typeof status) => void;
  vi.mocked(window.hermesAPI.githubAuthSignIn).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<GitHubPane />);
  await screen.findByText("settings.github.unknown");
  fireEvent.click(screen.getByText("settings.github.signIn"));
  fireEvent.click(screen.getByText("common.cancel"));
  expect(window.hermesAPI.githubAuthCancel).toHaveBeenCalledTimes(1);
  await act(async () => finish(status));
  view.unmount();
  expect(window.hermesAPI.githubAuthCancel).toHaveBeenCalledTimes(2);
});
