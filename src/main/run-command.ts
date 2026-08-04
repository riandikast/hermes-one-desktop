import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ShellKind } from "./terminal-session";

export function scriptExtensionFor(kind: ShellKind): string {
  if (kind === "pwsh") return "ps1";
  if (kind === "cmd") return "cmd";
  return "sh";
}

/**
 * Write a multi-line command to a temp script so blocks, loops, and quotes
 * behave exactly as written. pwsh scripts get a UTF-8 BOM so Windows
 * PowerShell 5.1 (which assumes ANSI without it) reads non-ASCII correctly.
 * Returns the script path. Caller owns scheduling deletion.
 */
export async function writeTempScript(
  command: string,
  kind: ShellKind,
  tempDirOverride?: string,
): Promise<string> {
  const dir = tempDirOverride || tmpdir();
  const scriptPath = join(
    dir,
    `hermes-cmd-${randomUUID()}.${scriptExtensionFor(kind)}`,
  );
  const content = kind === "pwsh" ? `\ufeff${command}` : command;
  await writeFile(scriptPath, content, "utf8");
  return scriptPath;
}

/** Best-effort deferred cleanup of the temp script after a grace period. */
export function scheduleScriptCleanup(scriptPath: string, delayMs = 60_000): void {
  const timer = setTimeout(() => {
    unlink(scriptPath).catch(() => {
      /* best-effort */
    });
  }, delayMs);
  timer.unref?.();
}

/**
 * Run a command in a NEW OS terminal window (PowerShell on Windows, bash
 * elsewhere) instead of the built-in terminal dock. The command is written
 * to a temp script and the shell is spawned detached with the window kept
 * open (`-NoExit`) so the user sees the output.
 *
 * Windows uses the same absolute-path + `cmd /c start` pattern as
 * `openTerminalInDirectory` — bare `spawn("powershell.exe", …)` relies on
 * PATH resolution, which can fail inside Electron's packaged main process.
 */
export async function runCommandInOsTerminal(
  command: string,
  cwd?: string,
): Promise<boolean> {
  const kind: ShellKind = process.platform === "win32" ? "pwsh" : "sh";
  const scriptPath = await writeTempScript(command, kind);
  // Keep the temp script alive well past the window's likely lifespan.
  scheduleScriptCleanup(scriptPath, 180_000);

  const options = {
    cwd: cwd && cwd.trim() ? cwd.trim() : undefined,
    detached: true,
    stdio: "ignore" as const,
    windowsHide: false,
  };

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const cmdExe = join(systemRoot, "System32", "cmd.exe");
    const psExe = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const powershell = existsSync(psExe) ? psExe : "powershell.exe";
    const child = spawn(
      cmdExe,
      [
        "/c",
        "start",
        "",
        powershell,
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      options,
    );
    child.once("error", () => {
      /* start failed — nothing to clean up beyond the script timer */
    });
    child.unref();
  } else {
    const child = spawn("bash", [scriptPath], options);
    child.once("error", () => {
      /* same */
    });
    child.unref();
  }
  return true;
}
