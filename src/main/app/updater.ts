import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { autoUpdater, type AppUpdater } from "electron-updater";
import { dirname, join } from "path";
import { updaterLogger } from "../updater-log";
import { setupDesktopReleases } from "./desktop-releases";

interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

let autoUpdaterInstance: AppUpdater | null = null;

function updatePreferencesPath(): string {
  return join(app.getPath("userData"), "update-preferences.json");
}

function getAutoUpgradeEnabled(): boolean {
  const file = updatePreferencesPath();
  if (!existsSync(file)) {
    return true;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      autoUpgrade?: unknown;
    };
    return parsed.autoUpgrade !== false;
  } catch {
    return true;
  }
}

function setAutoUpgradeEnabled(enabled: boolean): void {
  const file = updatePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ autoUpgrade: enabled }, null, 2)}\n`);
}

export function setupUpdater({ getMainWindow }: UpdaterDeps): void {
  let normalBusy = false;
  let normalReady = false;
  const manual = setupDesktopReleases(
    () => {
      if (normalBusy || normalReady)
        throw new Error(
          "A normal update is active. Finish it before choosing another version.",
        );
      if (autoUpdaterInstance) {
        autoUpdaterInstance.autoDownload = false;
        autoUpdaterInstance.autoInstallOnAppQuit = false;
      }
    },
    () => {
      if (autoUpdaterInstance) {
        autoUpdaterInstance.autoDownload = getAutoUpgradeEnabled();
        autoUpdaterInstance.autoInstallOnAppQuit = true;
      }
    },
  );
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-auto-upgrade-enabled", () => getAutoUpgradeEnabled());
  ipcMain.handle("set-auto-upgrade-enabled", (_event, enabled: boolean) => {
    setAutoUpgradeEnabled(enabled);
    if (autoUpdaterInstance && !manual.active()) {
      autoUpdaterInstance.autoDownload = enabled;
    }
    return true;
  });

  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild) {
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {
      if (manual.active()) return;
    });
    return;
  }

  autoUpdaterInstance = autoUpdater;
  autoUpdater.logger = updaterLogger;
  autoUpdater.autoDownload = getAutoUpgradeEnabled();
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    getMainWindow()?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    normalReady = true;
    getMainWindow()?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    getMainWindow()?.webContents.send("update-error", err.message);
  });

  const checkNormal = async (): Promise<string | null> => {
    if (manual.active() || normalBusy) return null;
    normalBusy = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.downloadPromise) await result.downloadPromise;
      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    } finally {
      normalBusy = false;
    }
  };
  ipcMain.handle("check-for-updates", checkNormal);
  ipcMain.handle("download-update", async () => {
    if (manual.active() || normalBusy) return false;
    normalBusy = true;
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    } finally {
      normalBusy = false;
    }
  });
  ipcMain.handle("install-update", () => {
    if (manual.active()) return;
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    void checkNormal().catch((error: unknown) => updaterLogger.error(error));
  }, 5000);
}
