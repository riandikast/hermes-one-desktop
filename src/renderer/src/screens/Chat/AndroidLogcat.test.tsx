import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AndroidLogcat } from "./AndroidLogcat";
const api = {
  listAndroidDevices: vi.fn(),
  startAndroidLogcat: vi.fn(),
  readAndroidLogcat: vi.fn(),
  stopAndroidLogcat: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.listAndroidDevices.mockResolvedValue({
    devices: [{ serial: "phone", label: "Pixel", state: "device" }],
  });
  api.startAndroidLogcat.mockResolvedValue({ ok: true, id: "capture" });
  api.readAndroidLogcat.mockResolvedValue({
    running: true,
    lines: [
      { seq: 1, text: "Info line", priority: "I" },
      { seq: 2, text: "Fatal crash", priority: "F" },
    ],
  });
  api.stopAndroidLogcat.mockResolvedValue(undefined);
  Object.assign(window, { hermesAPI: { ...window.hermesAPI, ...api } });
});
it("does not capture until Start; filters, pauses and stops the owned capture on unmount", async () => {
  const view = render(<AndroidLogcat onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Android device")).toHaveValue("phone"),
  );
  expect(api.startAndroidLogcat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByText("Fatal crash")).toBeTruthy();
  expect(api.startAndroidLogcat).toHaveBeenCalledWith("phone");
  fireEvent.change(screen.getByLabelText("Minimum log priority"), {
    target: { value: "E" },
  });
  expect(screen.queryByText("Info line")).toBeNull();
  fireEvent.change(screen.getByLabelText("Filter device logs"), {
    target: { value: "missing" },
  });
  expect(screen.queryByText("Fatal crash")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(screen.getByText(/Paused — device reader/)).toBeTruthy();
  view.unmount();
  expect(api.stopAndroidLogcat).toHaveBeenCalledWith("capture");
});
it("stops a late start reply after the dialog has closed", async () => {
  let finish!: (value: { ok: true; id: string }) => void;
  api.startAndroidLogcat.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<AndroidLogcat onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Android device")).toHaveValue("phone"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  view.unmount();
  await act(async () => finish({ ok: true, id: "late" }));
  expect(api.stopAndroidLogcat).toHaveBeenCalledWith("late");
});
it("shows unauthorized devices but refuses starting them", async () => {
  api.listAndroidDevices.mockResolvedValue({
    devices: [{ serial: "phone", label: "Pixel", state: "unauthorized" }],
  });
  render(<AndroidLogcat onClose={vi.fn()} />);
  expect(
    await screen.findByRole("option", { name: /unauthorized/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
});
