import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type TerminalPreference = "powershell" | "cmd";

export function getTerminalPreference(): TerminalPreference {
  try {
    const value = JSON.parse(readFileSync(join(app.getPath("userData"), "terminal-preference.json"), "utf8"));
    if (value.shell === "cmd") return "cmd";
  } catch { /* Missing/corrupt settings retain the existing PowerShell default. */ }
  return "powershell";
}

export function setTerminalPreference(shell: unknown): boolean {
  if (shell !== "powershell" && shell !== "cmd") return false;
  try {
    const dir = app.getPath("userData");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "terminal-preference.json"), JSON.stringify({ shell }), "utf8");
    return true;
  } catch { return false; }
}
