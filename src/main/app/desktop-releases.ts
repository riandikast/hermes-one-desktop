import { app, ipcMain } from "electron";
import { NsisUpdater } from "electron-updater";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import type { UpdateInfo } from "builder-util-runtime";
import type {
  DesktopRelease,
  DesktopReleaseState,
} from "../../shared/desktop-releases";

const API =
  "https://api.github.com/repos/riandikast/hermes-one-desktop/releases";
const DOWNLOAD =
  "https://github.com/riandikast/hermes-one-desktop/releases/download/";
const TAG = /^custom-v(\d+\.\d+\.\d+)$/;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Hermes-One-Desktop",
};

async function request(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `GitHub releases request failed (${response.status}). Try again later.`,
    );
  return response;
}

// Only the fork's current x64 NSIS naming contract is supported, never portable/web installers.
export function releaseCandidate(value: unknown): DesktopRelease | null {
  const r = value as {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name: string; browser_download_url: string }[];
  };
  if (
    !r ||
    typeof r.tag_name !== "string" ||
    !TAG.test(r.tag_name) ||
    r.draft ||
    r.prerelease ||
    !Array.isArray(r.assets)
  )
    return null;
  const version = TAG.exec(r.tag_name)![1];
  const base = `${DOWNLOAD}${r.tag_name}/`;
  const names = [`hermes-desktop-${version}-setup.exe`, "latest.yml"];
  if (
    !names.every((name) =>
      r.assets!.some(
        (a) => a.name === name && a.browser_download_url === `${base}${name}`,
      ),
    )
  )
    return null;
  return { tag: r.tag_name, version };
}

export function validateReleaseInfo(
  release: DesktopRelease,
  info: UpdateInfo,
): void {
  const name = `hermes-desktop-${release.version}-setup.exe`;
  if (
    info.version !== release.version ||
    info.path !== name ||
    ("packages" in info && info.packages) ||
    !Array.isArray(info.files) ||
    info.files.length !== 1 ||
    info.files[0].url !== name ||
    !/^[A-Za-z0-9+/]{86}==$/.test(info.files[0].sha512) ||
    info.sha512 !== info.files[0].sha512 ||
    !Number.isSafeInteger(info.files[0].size) ||
    info.files[0].size! <= 0
  ) {
    throw new Error(
      "Release metadata does not match the selected Windows setup installer.",
    );
  }
}

export function isOlderVersion(selected: string, installed: string): boolean {
  const a = selected.split(".").map(Number);
  const b = installed.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export function setupDesktopReleases(
  acquire: () => void,
  releaseNormal: () => void,
): { active: () => boolean } {
  let selected: NsisUpdater | null = null;
  let state: DesktopReleaseState = { phase: "idle", version: null };
  let locked = false;
  const reason = !app.isPackaged
    ? "Choose version is unavailable in development builds."
    : process.env.PORTABLE_EXECUTABLE_DIR
      ? "Portable builds cannot install updates. Use the Windows setup installer."
      : process.platform !== "win32" || process.arch !== "x64"
        ? "Choose version requires the Windows x64 setup installation."
        : "";
  const available = () => {
    if (reason) throw new Error(reason);
  };
  const clear = () => {
    selected = null;
    state = { phase: "idle", version: null };
    locked = false;
    releaseNormal();
  };
  ipcMain.handle("desktop-releases-list", async (_event, page: unknown = 1) => {
    if (reason)
      return {
        available: false,
        reason,
        installed: app.getVersion(),
        releases: [],
        nextPage: null,
      };
    if (
      !Number.isSafeInteger(page) ||
      (page as number) < 1 ||
      (page as number) > 1000
    )
      throw new Error("Invalid release page.");
    const response = await request(`${API}?per_page=20&page=${page}`);
    const values: unknown = await response.json();
    if (!Array.isArray(values))
      throw new Error("Invalid GitHub release response.");
    const releases: DesktopRelease[] = [];
    for (const value of values) {
      const candidate = releaseCandidate(value);
      if (!candidate) continue;
      const metadataUrl = DOWNLOAD + candidate.tag + "/latest.yml";
      const raw = await (await request(metadataUrl)).text();
      try {
        validateReleaseInfo(
          candidate,
          parseUpdateInfo(raw, "latest.yml", new URL(metadataUrl)),
        );
        releases.push(candidate);
      } catch {
        /* Malformed or incompatible metadata is never offered for installation. */
      }
    }
    return {
      available: true,
      reason: "",
      installed: app.getVersion(),
      latest:
        releaseCandidate(await (await request(API + "/latest")).json())
          ?.version ?? null,
      releases,
      nextPage: values.length === 20 ? (page as number) + 1 : null,
    };
  });
  ipcMain.handle("desktop-release-state", () => state);
  ipcMain.handle(
    "desktop-release-download",
    async (_event, tag: unknown, consent: unknown) => {
      available();
      if (typeof tag !== "string" || !TAG.test(tag))
        throw new Error("Invalid release tag.");
      if (locked)
        throw new Error(
          "A selected release is already active. Cancel it first.",
        );
      const version = TAG.exec(tag)![1];
      if (version === app.getVersion())
        throw new Error("This version is already installed.");
      if (isOlderVersion(version, app.getVersion()) && consent !== true)
        throw new Error("Confirm the downgrade before downloading.");
      acquire();
      locked = true;
      state = { phase: "downloading", version };
      try {
        const candidate = releaseCandidate(
          await (
            await request(`${API}/tags/${encodeURIComponent(tag)}`)
          ).json(),
        );
        if (!candidate)
          throw new Error(
            "Release has no compatible setup installer and metadata.",
          );
        const base = `${DOWNLOAD}${tag}/`;
        const text = await (await request(`${base}latest.yml`)).text();
        const info = parseUpdateInfo(
          text,
          "latest.yml",
          new URL(`${base}latest.yml`),
        );
        validateReleaseInfo(candidate, info);
        const updater = new NsisUpdater({
          provider: "generic",
          url: base,
          useMultipleRangeRequest: false,
        });
        selected = updater;
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.allowDowngrade = true;
        updater.allowPrerelease = false;
        updater.disableDifferentialDownload = true;
        updater.on("error", () => {}); // IPC returns the failure; avoid an unhandled EventEmitter error.
        const result = await updater.checkForUpdates();
        if (!result || result.updateInfo.version !== version)
          throw new Error("Selected release changed. Nothing was downloaded.");
        validateReleaseInfo(candidate, result.updateInfo);
        if (result.updateInfo.sha512 !== info.sha512)
          throw new Error("Release metadata changed. Nothing was downloaded.");
        await updater.downloadUpdate();
        state = { phase: "ready", version };
        return state;
      } catch (error) {
        clear();
        throw error;
      }
    },
  );
  ipcMain.handle("desktop-release-cancel", () => {
    if (state.phase === "downloading")
      throw new Error("Wait for the download to finish before discarding it.");
    if (selected) selected.autoInstallOnAppQuit = false;
    clear();
    return state;
  });
  ipcMain.handle("desktop-release-install", (_event, version: unknown) => {
    available();
    if (!selected || state.phase !== "ready" || version !== state.version)
      throw new Error("No matching selected installer is ready.");
    // Keep the isolated feed alive through quitAndInstall; it never becomes the normal feed.
    selected.quitAndInstall(false, true);
    clear();
  });
  return { active: () => locked };
}
