// @vitest-environment node

import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  openTerminalInDirectory,
  resolveTerminalCommand,
  resolveTerminalCommandAsync,
} from "./terminal-launcher";

const SYSTEM_DRIVE_ENV = { SystemDrive: "C:" } as NodeJS.ProcessEnv;

const CMD_EXE = "C:\\Windows\\System32\\cmd.exe";
const PWSH_EXE = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const WINDOWS_TERMINAL_EXE =
  "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\WindowsTerminal.exe";
const WINDOWS_APPS_DIR = "C:\\Program Files\\WindowsApps";

function existsFor(...existing: string[]): (filePath: string) => boolean {
  const known = new Set(existing.map((path) => path.toLowerCase()));
  return (filePath: string) => known.has(filePath.toLowerCase());
}

function noWindowsPackages(_packageName: string): string[] {
  return [];
}

describe("terminal launcher (win32)", () => {
  it("launches Windows Terminal directly for nested paths with spaces (async)", async () => {
    const dirPath = "C:\\Users\\me\\My Projects\\App\\src";

    const terminal = await resolveTerminalCommandAsync(dirPath, {
      platform: "win32",
      env: SYSTEM_DRIVE_ENV,
      exists: existsFor(CMD_EXE, WINDOWS_TERMINAL_EXE),
      listDirs: (dirPath) =>
        dirPath.toLowerCase() === WINDOWS_APPS_DIR.toLowerCase()
          ? ["Microsoft.WindowsTerminal_8wekyb3d8bbwe"]
          : [],
      getWindowsPackageInstallLocations: noWindowsPackages,
    });

    expect(terminal).not.toBeNull();
    expect(terminal!.command).toMatch(/WindowsTerminal\.exe$/);
    expect(terminal!.args).toEqual(["-d", dirPath]);
    expect(terminal!.cwd).toBe(dirPath);
  });

  it("launches Windows Terminal directly for nested paths with spaces (sync)", () => {
    const dirPath = "C:\\Users\\me\\My Projects\\App\\src";

    const terminal = resolveTerminalCommand(dirPath, {
      platform: "win32",
      env: SYSTEM_DRIVE_ENV,
      exists: existsFor(CMD_EXE, WINDOWS_TERMINAL_EXE),
      listDirs: () => ["Microsoft.WindowsTerminal_8wekyb3d8bbwe"],
      getWindowsPackageInstallLocations: (packageName) =>
        packageName === "Microsoft.WindowsTerminal"
          ? ["C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_8wekyb3d8bbwe"]
          : [],
    });

    expect(terminal).not.toBeNull();
    expect(terminal!.command).toBe(WINDOWS_TERMINAL_EXE);
    expect(terminal!.args).toEqual(["-d", dirPath]);
    expect(terminal!.cwd).toBe(dirPath);
  });

  it("launches pwsh directly without a cmd wrapper", () => {
    const dirPath = "C:\\Users\\me\\My Projects\\App\\src";

    const terminal = resolveTerminalCommand(dirPath, {
      platform: "win32",
      env: SYSTEM_DRIVE_ENV,
      exists: existsFor(CMD_EXE, PWSH_EXE),
      listDirs: () => [],
      getWindowsPackageInstallLocations: noWindowsPackages,
    });

    expect(terminal).not.toBeNull();
    expect(terminal!.command).toBe(PWSH_EXE);
    expect(terminal!.args).toEqual(["-NoExit", "-NoLogo"]);
    expect(terminal!.cwd).toBe(dirPath);
    for (const arg of terminal!.args) {
      expect(["/c", "start", "/d", "/D"]).not.toContain(arg);
    }
  });

  it("resolves the drive root with cwd set to the root", () => {
    const terminal = resolveTerminalCommand("C:\\", {
      platform: "win32",
      env: SYSTEM_DRIVE_ENV,
      exists: existsFor(CMD_EXE, PWSH_EXE),
      listDirs: () => [],
      getWindowsPackageInstallLocations: noWindowsPackages,
    });

    expect(terminal).not.toBeNull();
    expect(terminal!.cwd).toBe("C:\\");
  });
});

describe("openTerminalInDirectory", () => {
  it("returns false for a nonexistent directory without spawning", async () => {
    const missingDir = join(tmpdir(), "hermes-missing-" + Date.now());
    expect(await openTerminalInDirectory(missingDir)).toBe(false);
  });
});
