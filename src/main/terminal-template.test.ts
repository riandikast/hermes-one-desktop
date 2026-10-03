// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTerminalSession, killSession, writeToSession, shellKindFor } from "./terminal-session";

function session(shell: string) {
  const write = vi.fn();
  const spawn = vi.fn(() => ({ write, resize: vi.fn(), kill: vi.fn(), onData: vi.fn(), onExit: vi.fn() }));
  const id = createTerminalSession(shell, "original", 80, 24, vi.fn(), vi.fn(), { spawn } as unknown as typeof import("node-pty"));
  return { id, write, spawn };
}

describe("template writes reuse the PTY shell", () => {
  it("recognizes standalone pwsh.exe", () => expect(shellKindFor("pwsh.exe")).toBe("pwsh"));
  it.each(["pwsh.exe", "cmd.exe", "/bin/bash"])("keeps absent or blank cwd in %s", (shell) => {
    const { id, write, spawn } = session(shell);
    try {
      for (const cwd of [undefined, "", "   "]) {
        writeToSession(id, "  echo exact  \r", cwd);
        // With no cwd there is nothing to wrap, so user/typed input is forwarded
        // VERBATIM — the pty owns the line buffer and must see the exact bytes.
        expect(write).toHaveBeenLastCalledWith("  echo exact  \r");
      }
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally { killSession(id); }
  });
  it.each([
    ["pwsh.exe", "D:/O'Brien [x] $value", "Set-Location -LiteralPath 'D:/O''Brien [x] $value'; if ($?) { echo exact }\r"],
    ["cmd.exe", "D:\\saved project & files", 'cd /d "D:\\saved project & files" && (echo exact)\r'],
    ["/bin/bash", "/saved/O'Brien $value", "cd -- '/saved/O'\\''Brien $value' && { echo exact; }\r"],
  ])("quotes saved cwd for %s", (shell, cwd, expected) => {
    const { id, write, spawn } = session(shell);
    try {
      writeToSession(id, "  echo exact  \r", cwd);
      expect(write).toHaveBeenCalledExactlyOnceWith(expected);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally { killSession(id); }
  });
  // The regression: the command's own trailing CR used to land INSIDE the
  // wrapped block, so pwsh/bash saw an unterminated compound statement and the
  // template appeared to "not cd". Exactly one line terminator must remain.
  it.each(["pwsh.exe", "cmd.exe", "/bin/bash"])("emits exactly one trailing enter for %s", (shell) => {
    const { id, write } = session(shell);
    try {
      writeToSession(id, "echo hi\r", "D:/proj");
      const out = write.mock.calls.at(-1)![0] as string;
      expect(out.endsWith("\r")).toBe(true);
      expect(out.endsWith("\r\r")).toBe(false);
      // Running the command from the saved dir must be expressed in ONE line.
      expect(out.includes("\n")).toBe(false);
      expect(out.includes("D:/proj")).toBe(true);
    } finally { killSession(id); }
  });
  it("forwards a backslash-pathed command untouched when cwd is absent", () => {
    const { id, write } = session("pwsh.exe");
    try {
      writeToSession(id, "git status\r", undefined);
      expect(write).toHaveBeenLastCalledWith("git status\r");
    } finally { killSession(id); }
  });
  // Real template: "Flutter PUBG" is `flutter clean\nflutter pub get`. Written
  // raw, the second line raced the first command's prompt.
  it.each([
    ["pwsh.exe", "D:/proj", "Set-Location -LiteralPath 'D:/proj'; if ($?) { flutter clean; flutter pub get }\r"],
    ["cmd.exe", "D:/proj", 'cd /d "D:/proj" && (flutter clean) && (flutter pub get)\r'],
    ["/bin/bash", "/proj", "cd -- '/proj' && { flutter clean; flutter pub get; }\r"],
  ])("joins a multi-line template into one submission for %s", (shell, cwd, expected) => {
    const { id, write } = session(shell);
    try {
      writeToSession(id, "flutter clean\nflutter pub get", cwd);
      expect(write).toHaveBeenCalledExactlyOnceWith(expected);
    } finally { killSession(id); }
  });
  it("joins a multi-line template even with no cwd to wrap", () => {
    const { id, write } = session("pwsh.exe");
    try {
      writeToSession(id, "adb kill-server\nadb start-server\r", undefined);
      expect(write).toHaveBeenLastCalledWith("adb kill-server; adb start-server\r");
    } finally { killSession(id); }
  });
  it.each([
    ["cmd.exe", "D:/%TEMP%"], ["cmd.exe", "D:/!expand!"], ["cmd.exe", 'D:/" & evil'],
    ["pwsh.exe", "D:/bad\rcommand"], ["/bin/bash", "/bad\ncommand"],
  ])("rejects unsafe cwd without writing: %s %s", (shell, cwd) => {
    const { id, write } = session(shell);
    try {
      expect(() => writeToSession(id, "echo exact\r", cwd)).toThrow();
      expect(write).not.toHaveBeenCalled();
    } finally { killSession(id); }
  });
  it("does not create a replacement for a missing terminal", () => {
    expect(() => writeToSession("missing", "echo exact\r", "/saved")).toThrow(/No session/);
  });
});
