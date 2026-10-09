import { existsSync } from "fs";
import { join } from "path";
import * as pty from "node-pty";

export type ShellKind = "pwsh" | "cmd" | "sh";

export interface SessionHandle {
  shell: ShellKind;
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
  preference: "powershell" | "cmd" = "powershell",
): string {
  if (platform === "win32") {
    if (preference === "cmd") return join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
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
  if (lower.includes("powershell") || /pwsh(?:\.exe)?$/.test(lower)) return "pwsh";
  if (lower.endsWith("cmd") || lower.endsWith("cmd.exe")) return "cmd";
  return "sh";
}

/**
 * cmd.exe cannot safely receive a script path containing quotes, percent
 * expansion, exclamation marks (with delayed expansion) or control characters.
 * Compared by char code so the check needs no control-character regex.
 */
export function isCmdScriptPathSafe(scriptPath: string): boolean {
  for (const ch of scriptPath) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
    if (ch === '"' || ch === "%" || ch === "!") return false;
  }
  return true;
}

/** Line fed to the PTY to run a temp script while keeping the shell alive. */
export function buildFeedLine(scriptPath: string, kind: ShellKind): string {
  const enter = String.fromCharCode(13);
  if (kind === "pwsh") return `& '${scriptPath.replace(/'/g, "''")}'${enter}`;
  if (kind === "cmd") {
    if (!isCmdScriptPathSafe(scriptPath)) throw new Error("Unsupported cmd script path");
    return `call "${scriptPath}"${enter}`;
  }
  return `. '${scriptPath}'${enter}`;
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
  const child = ptyModule.spawn(shell, shellKindFor(shell) === "cmd" ? ["/d", "/v:off"] : [], {
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
    shell: shellKindFor(shell),
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

export function writeToSession(id: string, data: string, cwd?: string): void {
  const session = sessions.get(id);
  if (!session) throw new Error(`No session with id: ${id}`);
  if (cwd !== undefined && typeof cwd !== "string") throw new Error("Invalid cwd");
  const parts = splitCommandLines(data);
  if (cwd?.trim()) {
    if (/[\x00-\x1f\x7f]/.test(cwd)) throw new Error("Invalid cwd");
    if (session.shell === "pwsh") {
      const quoted = cwd.replace(/'/g, "''");
      const body = parts.lines.join("; ");
      data = `Set-Location -LiteralPath '${quoted}'; if ($?) { ${body} }${parts.enter}`;
    } else if (session.shell === "cmd") {
      // cmd expands these even inside quotes; reject rather than change the path.
      if (/["%!]/.test(cwd)) throw new Error("Unsupported cmd cwd");
      // cmd cannot chain with `;`, so each line is parenthesized and `&&`-joined.
      const chained = parts.lines.map((line) => `(${line})`).join(" && ");
      data = `cd /d "${cwd}" && ${chained}${parts.enter}`;
    } else {
      const quoted = cwd.replace(/'/g, "'\\''");
      data = `cd -- '${quoted}' && { ${parts.lines.join("; ")}; }${parts.enter}`;
    }
  } else if (parts.lines.length > 1) {
    // No cwd to wrap, but still keep a multi-line template as ONE submission so
    // a later line cannot be typed into a prompt that has not returned yet.
    data = parts.lines.join(session.shell === "cmd" ? " && " : "; ") + parts.enter;
  }
  session.write(data);
}

/**
 * Split a template into its individual command lines, peeling the trailing
 * Enter off the last one.
 *
 * Two reasons this is needed rather than a raw write:
 *   1. A trailing CR must terminate the WRAPPED line, not sit inside the
 *      block — interpolating it raw left an unterminated compound statement
 *      and the shell hung waiting for the closer.
 *   2. Templates may be genuinely multi-line (`flutter clean` + `flutter pub
 *      get`). Written raw, the second line races the first command's prompt.
 */
function splitCommandLines(data: string): { lines: string[]; enter: string } {
  // An Enter arrives as a bare CR (what the key sends), a LF, or a CRLF. It is
  // peeled off FIRST so it can terminate the WRAPPED line; leaving it inside
  // the block left an unterminated compound statement that hung the shell.
  const match = data.match(/\r?\n?$/);
  const hadEnter = match !== null && match[0].length > 0;
  const body = hadEnter ? data.slice(0, -match[0].length) : data;
  // A template that omits its own Enter is still submitted; interactive input
  // always supplies one, and that exact terminator is preserved.
  const enter = hadEnter ? match[0] : "\r";
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { lines, enter };
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
