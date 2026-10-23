import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DesktopReleasePicker from "./DesktopReleasePicker";
vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (_key: string, options: { defaultValue: string }) =>
      options.defaultValue,
  }),
}));
const list = vi.fn();
const download = vi.fn();
const install = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listDesktopReleases: list,
      getDesktopReleaseState: async () => ({ phase: "idle", version: null }),
      downloadDesktopRelease: download,
      installDesktopRelease: install,
      cancelDesktopRelease: cancel,
    },
  });
  list.mockResolvedValue({
    available: true,
    installed: "0.7.18",
    latest: "0.7.18",
    releases: [{ tag: "custom-v0.7.17", version: "0.7.17" }],
    nextPage: 2,
  });
  download.mockImplementation(async (_tag, consent) => {
    if (!consent) throw new Error("Confirm the downgrade before downloading.");
    return { phase: "ready", version: "0.7.17" };
  });
  cancel.mockResolvedValue({ phase: "idle", version: null });
});
afterEach(cleanup);
it("requires explicit clicks; passes exact tag and consent; separate restart and discard", async () => {
  render(<DesktopReleasePicker />);
  expect(list).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Choose version"));
  await screen.findByText(/Installed: 0.7.18/);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "custom-v0.7.17" },
  });
  fireEvent.click(screen.getByText("Download selected version"));
  await screen.findByRole("alert");
  expect(download).toHaveBeenLastCalledWith("custom-v0.7.17", false);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Download selected version"));
  await screen.findByText("Restart and install selected version");
  expect(download).toHaveBeenLastCalledWith("custom-v0.7.17", true);
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Restart and install selected version"));
  await waitFor(() => expect(install).toHaveBeenCalledWith("0.7.17"));
  await waitFor(() =>
    expect(screen.getByText("Discard selected update")).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByText("Discard selected update"));
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it("loads subsequent pages and shows actionable errors", async () => {
  render(<DesktopReleasePicker />);
  fireEvent.click(screen.getByText("Choose version"));
  fireEvent.click(await screen.findByText("Load more releases"));
  await waitFor(() => expect(list).toHaveBeenCalledWith(2));
  list.mockRejectedValueOnce(new Error("GitHub rate limit"));
  await waitFor(() =>
    expect(screen.getByText("Choose version")).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByText("Choose version"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GitHub rate limit",
  );
});
it("explains portable unavailability without offering download", async () => {
  list.mockResolvedValueOnce({
    available: false,
    reason: "Portable builds cannot install updates.",
    releases: [],
    nextPage: null,
    installed: "0.7.18",
  });
  render(<DesktopReleasePicker />);
  fireEvent.click(screen.getByText("Choose version"));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Portable builds",
  );
  expect(screen.queryByText("Download selected version")).toBeNull();
  expect(download).not.toHaveBeenCalled();
});
