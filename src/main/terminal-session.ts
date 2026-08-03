import { existsSync } from "fs";
import { join } from "path";
import * as pty from "node-pty";

export type ShellKind = "pwsh" | "cmd" | "sh";

export interface SessionHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const sessions = new Map<string, SessionHandle>();
let nextSessionId = 1;

export function resolveShellExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const pwshCandidates = [
      join(programFiles, "PowerShell", "7", "pwsh.exe"),
      join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
    ];
    for (const candidate of pwshCandidates) {
      if (exists(candidate)) return candidate;
    }
    return "powershell.exe";
  }
  return env.SHELL || "/bin/bash";
}

export function shellKindFor(shell: string): ShellKind {
  const lower = shell.toLowerCase();
  if (lower.includes("powershell") || lower.endsWith("pwsh")) return "pwsh";
  if (lower.endsWith("cmd") || lower.endsWith("cmd.exe")) return "cmd";
  return "sh";
}

/** Line fed to the PTY to run a temp script while keeping the shell alive. */
export function buildFeedLine(scriptPath: string, kind: ShellKind): string {
  if (kind === "pwsh") return `& '${scriptPath}'\r`;
  if (kind === "cmd") return `call "${scriptPath}"\r`;
  return `. '${scriptPath}'\r`;
}

export function createTerminalSession(
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (id: string) => void,
  ptyModule: typeof pty = pty,
): string {
  const id = `term-${nextSessionId++}`;
  const child = ptyModule.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  });

  child.onData((data) => onData(data));
  child.onExit(() => {
    sessions.delete(id);
    onExit(id);
  });

  sessions.set(id, {
    write: (data) => child.write(data),
    resize: (c, r) => child.resize(c, r),
    kill: () => {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    },
  });
  return id;
}

export function writeToSession(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) throw new Error(`No session with id: ${id}`);
  session.write(data);
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session) session.resize(cols, rows);
}

export function killSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.kill();
}

export function sessionCount(): number {
  return sessions.size;
}
