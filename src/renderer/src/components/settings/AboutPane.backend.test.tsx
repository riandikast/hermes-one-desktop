// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AboutPane from "./AboutPane";
const settings = { hermesVersion: "v1", hermesHome: "install", parsedVersion: { version: "1", updateInfo: null }, appVersion: "1" };
vi.mock("./SettingsDataContext", () => ({ useSettings: () => settings }));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../screens/Settings/ConfigHealth", () => ({ ConfigHealth: () => null }));
vi.mock("./DesktopReleasePicker", () => ({ default: () => null }));
vi.mock("../common/BrandLogo", () => ({ default: () => null }));
beforeEach(() => {
  Object.assign(window, { hermesAPI: { checkBackendUpdate: vi.fn(), openExternal: vi.fn() } });
});
it.each(["available", "ahead", "diverged", "unknown", "current"] as const)("uses authoritative %s status instead of missing CLI update text", async (status) => {
  vi.mocked(window.hermesAPI.checkBackendUpdate).mockResolvedValue({ status, detail: `proof: ${status}` });
  render(<AboutPane />);
  await screen.findByText(`proof: ${status}`);
  expect(screen.queryByText("settings.statusUpToDate") !== null).toBe(status === "current");
  expect(screen.queryByRole("button", { name: "settings.updateEngine" }) !== null).toBe(status === "available");
  const source = screen.getByRole("link", { name: "https://github.com/NousResearch/hermes-agent" });
  fireEvent.click(source);
  expect(window.hermesAPI.openExternal).toHaveBeenCalledWith("https://github.com/NousResearch/hermes-agent");
  expect(screen.getByText("riandikast/hermes-one-desktop")).toBeTruthy();
});
it("exposes a failed check and retry instead of declaring latest", async () => {
  vi.mocked(window.hermesAPI.checkBackendUpdate).mockRejectedValue(new Error("offline"));
  render(<AboutPane />);
  await screen.findByText("Unknown");
  expect(screen.queryByText("settings.statusUpToDate")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "settings.checkForUpdates" })[0]);
  expect(window.hermesAPI.checkBackendUpdate).toHaveBeenCalledTimes(2);
});
