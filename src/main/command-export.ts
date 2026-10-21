import { unlink, writeFile } from "fs/promises";
import { isAbsolute, join } from "path";
import { listCommands } from "./command-store";
import type { TerminalPreference } from "./terminal-preference";

/** Export only an existing template; never run it or change execution policy. */
export async function exportCommand(
  input: unknown,
  shell: TerminalPreference,
  homeOverride?: string,
): Promise<{ path: string; shell: TerminalPreference }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid export request");
  const payload = input as Record<string, unknown>;
  if (Object.keys(payload).some((key) => key !== "id" && key !== "destination") ||
      typeof payload.id !== "string" || !payload.id ||
      typeof payload.destination !== "string" || !isAbsolute(payload.destination) ||
      /[\x00-\x1f]/.test(payload.destination) ||
      payload.destination.split(/[\\/]/).includes("..")) throw new Error("Invalid export destination");
  if (shell !== "cmd" && shell !== "powershell") throw new Error("Unsupported export shell");
  const record = (await listCommands(homeOverride)).find((item) => item.id === payload.id);
  if (!record || typeof record.name !== "string" || !record.name.trim() ||
      typeof record.command !== "string" || !record.command.trim() || record.command.includes("\0") ||
      typeof record.cwd !== "string" || /["\x00-\x1f]/.test(record.cwd)) throw new Error("Invalid command template");
  let base = record.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[ .]+$/g, "").slice(0, 80);
  if (!base || /^\.+$/.test(base)) base = "command";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  for (let suffix = 0; suffix < 100; suffix++) {
    const stem = `${base}${suffix ? ` (${suffix})` : ""}${shell === "powershell" ? ".powershell" : ""}`;
    const path = join(payload.destination, `${stem}.cmd`);
    const psPath = join(payload.destination, `${stem}.ps1`);
    let ownedPs = false;
    try {
      if (shell === "powershell") {
        const cwd = record.cwd ? `Set-Location -LiteralPath '${record.cwd.replace(/'/g, "''")}' -ErrorAction Stop\r\n` : "";
        await writeFile(psPath, `\ufeff${cwd}${record.command}`, { encoding: "utf8", flag: "wx" });
        ownedPs = true;
      }
      const cwd = record.cwd ? `pushd "${record.cwd.replace(/%/g, "%%")}" || exit /b 1\r\n` : "";
      const body = shell === "cmd"
        ? `${cwd}${record.command}`
        : `rem Requires Windows PowerShell and permission to run the companion .ps1 file.\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -File "%~dp0${stem.replace(/%/g, "%%")}.ps1"`;
      await writeFile(path, `@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n${body}\r\nset "hermes_export_exit=%errorlevel%"\r\npause\r\nexit /b %hermes_export_exit%\r\n`, { encoding: "utf8", flag: "wx" });
      return { path, shell };
    } catch (error) {
      if (ownedPs) await unlink(psPath);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Could not save command launcher");
    }
  }
  throw new Error("Too many existing exports with this name");
}
