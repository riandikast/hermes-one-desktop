// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  updater: { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn() },
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "0.7.37",
    getPath: () => "unused",
  },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mock.handlers.set(name, handler),
  },
}));
vi.mock("fs", () => ({
  existsSync: () => false,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("electron-updater", () => ({ autoUpdater: mock.updater }));
vi.mock("../src/main/updater-log", () => ({
  updaterLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/main/app/desktop-releases", () => ({
  setupDesktopReleases: () => ({ active: () => false }),
}));
import { setupUpdater } from "../src/main/app/updater";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function setup(result: Record<string, unknown>): {
  check: () => unknown;
  updater: typeof mock.updater;
} {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv("PORTABLE_EXECUTABLE_DIR", "");
  mock.updater.checkForUpdates.mockResolvedValue(result);
  setupUpdater({ getMainWindow: () => null });
  return {
    check: () => mock.handlers.get("check-for-updates")!(),
    updater: mock.updater,
  };
}

// @lat: [[desktop-updates#Normal update availability]]
it.each(["0.7.37", "0.7.36"])(
  "does not offer unavailable release metadata %s",
  async (version) => {
    const { check } = setup({
      isUpdateAvailable: false,
      updateInfo: { version },
    });
    expect(await check()).toBeNull();
  },
);

it("offers a confirmed newer release", async () => {
  const { check } = setup({
    isUpdateAvailable: true,
    updateInfo: { version: "0.7.38" },
  });
  expect(await check()).toBe("0.7.38");
});

it("propagates failed checks instead of reporting up to date", async () => {
  const { check, updater } = setup({});
  updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
  await expect(check()).rejects.toThrow("offline");
});
