import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import GitHubPane from "./GitHubPane";
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const status: Awaited<ReturnType<typeof window.hermesAPI.githubAuthStatus>> = { git: true, manager: true, helper: false, auth: "unknown" };
beforeEach(() => {
  Object.assign(window, { hermesAPI: {
    githubAuthStatus: vi.fn().mockResolvedValue(status),
    githubAuthSignIn: vi.fn().mockResolvedValue({ ...status, helper: true, auth: "authenticated", account: "octocat" }),
    githubAuthCancel: vi.fn().mockResolvedValue(undefined),
  } });
});
it("checks status automatically but signs in only after a click", async () => {
  render(<GitHubPane />);
  await screen.findByText("settings.github.unknown");
  expect(window.hermesAPI.githubAuthSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("settings.github.signIn"));
  await screen.findByText("settings.github.authenticated (octocat)");
  fireEvent.click(screen.getByText("settings.github.verify"));
  await waitFor(() => expect(window.hermesAPI.githubAuthStatus).toHaveBeenCalledTimes(2));
});
it("shows errors and disables sign-in without native manager", async () => {
  vi.mocked(window.hermesAPI.githubAuthStatus).mockRejectedValueOnce(new Error("IPC unavailable"));
  render(<GitHubPane />);
  await screen.findByRole("alert");
  expect(screen.getByText("settings.github.signIn")).toBeDisabled();
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
