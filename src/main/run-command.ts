import { randomUUID } from "crypto";
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
