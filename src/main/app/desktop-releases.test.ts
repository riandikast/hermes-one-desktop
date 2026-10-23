import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  app: { isPackaged: true, getVersion: () => "0.7.18" },
  instances: [] as any[],
}));
vi.mock("electron", () => ({
  app: mock.app,
  ipcMain: {
    handle: (key: string, fn: (...args: any[]) => any) =>
      mock.handlers.set(key, fn),
  },
}));
vi.mock("electron-updater", () => ({
  NsisUpdater: class {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    allowDowngrade = false;
    allowPrerelease = true;
    disableDifferentialDownload = false;
    on = vi.fn();
    downloadUpdate = vi.fn(async () => []);
    quitAndInstall = vi.fn();
    checkForUpdates = vi.fn(async () => ({ updateInfo: info() }));
    constructor(public options: unknown) {
      mock.instances.push(this);
    }
  },
}));
import {
  setupDesktopReleases,
  releaseCandidate,
  validateReleaseInfo,
} from "./desktop-releases";
const tag = "custom-v0.7.17";
const name = "hermes-desktop-0.7.17-setup.exe";
const base = `https://github.com/riandikast/hermes-one-desktop/releases/download/${tag}/`;
function info() {
  return {
    version: "0.7.17",
    path: name,
    sha512: "A".repeat(86) + "==",
    files: [{ url: name, sha512: "A".repeat(86) + "==", size: 100 }],
    releaseDate: "2026-10-23",
  };
}
function release() {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [name, "latest.yml"].map((name) => ({
      name,
      browser_download_url: base + name,
    })),
  };
}
function call(key: string, ...args: unknown[]) {
  return mock.handlers.get(key)!(null, ...args);
}
beforeEach(() => {
  mock.handlers.clear();
  mock.instances.length = 0;
  mock.app.isPackaged = true;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("?per_page") ? Array(20).fill(release()) : release(),
      text: async () => JSON.stringify(info()),
    })),
  );
});
// @lat: [[desktop-updates#Manual release selection]]
it("pins exact selected downgrade; requires consent, explicit download and restart; discard never installs", async () => {
  const acquire = vi.fn();
  const restore = vi.fn();
  const controller = setupDesktopReleases(acquire, restore);
  await expect(call("desktop-release-download", tag, false)).rejects.toThrow(
    "Confirm",
  );
  expect(mock.instances).toHaveLength(0);
  await call("desktop-release-download", tag, true);
  const updater = mock.instances[0];
  expect(updater.options).toEqual({
    provider: "generic",
    url: base,
    useMultipleRangeRequest: false,
  });
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.allowDowngrade).toBe(true);
  expect(updater.downloadUpdate).toHaveBeenCalledOnce();
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  expect(controller.active()).toBe(true);
  expect(() => call("desktop-release-install", "0.7.19")).toThrow("matching");
  call("desktop-release-install", "0.7.17");
  expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  expect(controller.active()).toBe(false);
  expect(restore).toHaveBeenCalledOnce();
  call("desktop-release-cancel");
});
it("rejects mismatched metadata and external/noninstaller assets", () => {
  expect(releaseCandidate(release())).toEqual({ tag, version: "0.7.17" });
  expect(
    releaseCandidate({
      ...release(),
      assets: [{ name, browser_download_url: "https://evil.test/setup.exe" }],
    }),
  ).toBeNull();
  expect(
    releaseCandidate({
      ...release(),
      assets: [
        { name: "portable.exe", browser_download_url: base + "portable.exe" },
      ],
    }),
  ).toBeNull();
  expect(() =>
    validateReleaseInfo(
      { tag, version: "0.7.17" },
      { ...info(), version: "0.7.19" },
    ),
  ).toThrow("metadata");
  expect(() =>
    validateReleaseInfo(
      { tag, version: "0.7.17" },
      {
        ...info(),
        files: [{ ...info().files[0], url: "https://evil.test/setup.exe" }],
      },
    ),
  ).toThrow("metadata");
});
it("paginates fixed fork endpoint and propagates HTTP failures", async () => {
  setupDesktopReleases(vi.fn(), vi.fn());
  const page = await call("desktop-releases-list", 2);
  expect(page.nextPage).toBe(3);
  expect(page.latest).toBe("0.7.17");
  expect(fetch).toHaveBeenCalledWith(
    "https://api.github.com/repos/riandikast/hermes-one-desktop/releases?per_page=20&page=2",
    expect.anything(),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 403 })),
  );
  await expect(call("desktop-releases-list", 1)).rejects.toThrow("403");
  await expect(
    call("desktop-releases-list", "https://evil.test"),
  ).rejects.toThrow("Invalid release page");
});
it.each(["portable", "development"])(
  "disables %s without network or download",
  async (mode) => {
    if (mode === "portable")
      process.env.PORTABLE_EXECUTABLE_DIR = "C:/portable";
    else mock.app.isPackaged = false;
    setupDesktopReleases(vi.fn(), vi.fn());
    expect((await call("desktop-releases-list", 1)).available).toBe(false);
    await expect(call("desktop-release-download", tag, true)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(mock.instances).toHaveLength(0);
  },
);
it("clears failed pin so normal updates resume", async () => {
  const restore = vi.fn();
  const controller = setupDesktopReleases(vi.fn(), restore);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
  await expect(call("desktop-release-download", tag, true)).rejects.toThrow(
    "404",
  );
  expect(controller.active()).toBe(false);
  expect(restore).toHaveBeenCalledOnce();
});
