import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import NotificationsPane from "./NotificationsPane";
import { DEFAULT_NOTIFICATION_PREFS } from "../../../../shared/notifications";

const getPrefs = vi.fn();
const setPrefs = vi.fn();
const showTest = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getPrefs.mockResolvedValue({ ...DEFAULT_NOTIFICATION_PREFS });
  setPrefs.mockImplementation(async (prefs) => ({ ...prefs }));
  showTest.mockResolvedValue({ shown: true });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getNotificationPrefs: getPrefs,
      setNotificationPrefs: setPrefs,
      showTestNotification: showTest,
    },
  });
});

it("persists each switch immediately and disables kinds under the master switch", async () => {
  const view = renderWithI18n(<NotificationsPane />);
  const master = (await waitFor(
    () => view.getByLabelText("Desktop notifications") as HTMLInputElement,
  )) as HTMLInputElement;
  expect(master.checked).toBe(true);

  fireEvent.click(master);
  await waitFor(() =>
    expect(setPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    ),
  );

  const complete = view.getByLabelText("Turn finished") as HTMLInputElement;
  await waitFor(() => expect(complete.disabled).toBe(true));
});

it("sends a test notification and reports the result", async () => {
  const view = renderWithI18n(<NotificationsPane />);
  const button = await waitFor(() => view.getByRole("button", { name: "Send test" }));
  fireEvent.click(button);
  await waitFor(() => expect(showTest).toHaveBeenCalledTimes(1));
  expect(view.getByText("Test notification sent.")).toBeTruthy();
});

it("reports when the OS refused the test notification", async () => {
  showTest.mockResolvedValue({ shown: false, reason: "Off in Notification settings" });
  const view = renderWithI18n(<NotificationsPane />);
  fireEvent.click(await waitFor(() => view.getByRole("button", { name: "Send test" })));
  await waitFor(() => expect(view.getByText("Off in Notification settings")).toBeTruthy());
});
