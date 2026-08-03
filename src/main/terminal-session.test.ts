// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  buildFeedLine,
  createTerminalSession,
  killSession,
  resolveShellExecutable,
  shellKindFor,
  writeToSession,
} from "./terminal-session";

function fakePtyModule() {
  let dataCb: ((d: string) => void) | null = null;
  const spawn = vi.fn(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (d: string) => void) => {
      dataCb = cb;
    },
    onExit: () => {},
    emitData: (d: string) => dataCb?.(d),
  }));
  return { spawn };
}

describe("resolveShellExecutable", () => {
  it("prefers PowerShell 7 in Program Files on win32", () => {
    const env = { ProgramFiles: "C:\\Program Files" };
    expect(resolveShellExecutable("win32", env, (p) => p.includes("PowerShell"))).toBe(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );
  });

  it("falls back to Program Files (x86) for PowerShell 7", () => {
    const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };
    expect(resolveShellExecutable("win32", env, (p) => p.includes("(x86)"))).toBe(
      "C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe",
    );
  });

  it("falls back to powershell.exe when PowerShell 7 is absent on win32", () => {
    expect(resolveShellExecutable("win32", { ProgramFiles: "C:\\Program Files" }, () => false)).toBe(
      "powershell.exe",
    );
  });

  it("uses $SHELL on non-win32, defaulting to /bin/bash", () => {
    expect(resolveShellExecutable("linux", { SHELL: "/bin/zsh" }, () => true)).toBe("/bin/zsh");
    expect(resolveShellExecutable("linux", {}, () => true)).toBe("/bin/bash");
  });
});

describe("shellKindFor", () => {
  it("classifies shells", () => {
    expect(shellKindFor("powershell.exe")).toBe("pwsh");
    expect(shellKindFor("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh");
    expect(shellKindFor("cmd.exe")).toBe("cmd");
    expect(shellKindFor("/bin/bash")).toBe("sh");
    expect(shellKindFor("/bin/zsh")).toBe("sh");
  });
});

describe("createTerminalSession", () => {
  it("spawns a pty and registers the session, wiring data + exit", () => {
    const fake = fakePtyModule();
    const onData = vi.fn();
    const onExit = vi.fn();

    const id = createTerminalSession(
      "powershell.exe",
      "C:\\work",
      80,
      24,
      onData,
      onExit,
      fake as unknown as typeof import("node-pty"),
    );
    expect(typeof id).toBe("string");
    expect(fake.spawn).toHaveBeenCalledWith(
      "powershell.exe",
      [],
      { name: "xterm-256color", cols: 80, rows: 24, cwd: "C:\\work", env: expect.any(Object) },
    );

    (fake.spawn.mock.results[0].value as { emitData: (d: string) => void })
      .emitData("hello");
    expect(onData).toHaveBeenCalledWith("hello");

    writeToSession(id, "ls\r");
    expect(fake.spawn.mock.results[0].value.write).toHaveBeenCalledWith("ls\r");

    killSession(id);
    expect(fake.spawn.mock.results[0].value.kill).toHaveBeenCalled();
    expect(() => writeToSession(id, "x")).toThrow(/no session/i);
  });

  it("does not crash when writing to a missing session (guarded)", () => {
    expect(() => writeToSession("does-not-exist", "x")).toThrow(/no session/i);
    killSession("does-not-exist");
  });
});

describe("buildFeedLine", () => {
  it("builds the run line per shell kind", () => {
    expect(buildFeedLine("C:\\tmp\\hermes-cmd-1.ps1", "pwsh")).toBe("& 'C:\\tmp\\hermes-cmd-1.ps1'\r");
    expect(buildFeedLine("C:\\tmp\\hermes-cmd-1.cmd", "cmd")).toBe('call "C:\\tmp\\hermes-cmd-1.cmd"\r');
    expect(buildFeedLine("/tmp/hermes-cmd-1.sh", "sh")).toBe(". '/tmp/hermes-cmd-1.sh'\r");
  });
});
