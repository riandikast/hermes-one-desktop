import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

vi.mock("electron", () => ({ app: undefined, BrowserWindow: class {} }));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: "local" }),
  getModelConfig: () => ({ provider: "ollama", model: "test", baseUrl: "" }),
  hasOAuthCredentials: () => false,
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: () => process.env.HERMES_HOME,
  stripAnsi: (text: string) => text,
}));
const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("child_process", () => ({ ...childProcess, default: childProcess }));
vi.mock("node:child_process", () => ({
  ...childProcess,
  default: childProcess,
}));
import { execFileSync } from "child_process";

const homes: string[] = [];
function fixture(): {
  home: string;
  repo: string;
  touch: (path: string) => void;
} {
  const home = mkdtempSync(
    join(process.env.TMPDIR || tmpdir(), "hermes-runtime-test-"),
  );
  homes.push(home);
  vi.stubEnv("HERMES_HOME", home);
  vi.resetModules();
  return {
    home,
    repo: join(home, "hermes-agent"),
    touch(path: string) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true });
});

// @lat: [[backend-installation#Managed runtime discovery]]
it("accepts a published managed runtime without an in-tree venv", async () => {
  const { home, repo, touch } = fixture();
  const launcher = join(
    repo,
    ".hermes",
    "bin",
    process.platform === "win32" ? "hermes.exe" : "hermes",
  );
  const python = join(
    home,
    "tools",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python",
  );
  touch(launcher);
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  const prefix = [
    "-I",
    "-c",
    "import hermes_bootstrap; import runpy; runpy.run_module('hermes_cli.main', run_name='__main__')",
  ];
  vi.mocked(execFileSync).mockReturnValue(JSON.stringify([python, ...prefix]));

  const installer = await import("../src/main/installer");
  expect(installer.validateHermesHome(home)).toBe(true);
  expect(installer.checkInstallStatus().installed).toBe(true);
  expect(installer.HERMES_PYTHON).toBe(python);
  expect(installer.HERMES_SCRIPT).toBe(launcher);
  expect(installer.hermesCliArgs(["--version"])).toEqual([
    ...prefix,
    "--version",
  ]);
  expect(execFileSync).toHaveBeenCalledWith(
    launcher,
    ["--print-runtime-command"],
    expect.objectContaining({
      cwd: repo,
      env: expect.objectContaining({ HERMES_HOME: home }),
      windowsHide: true,
    }),
  );
});

it.skipIf(process.platform !== "win32")(
  "refreshes runtime discovery after installation without restarting",
  async () => {
    const { home, repo, touch } = fixture();
    const installer = await import("../src/main/installer");
    expect(installer.checkInstallStatus().installed).toBe(false);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    childProcess.spawn.mockReturnValue(child);
    const installing = installer.runInstall(() => {});
    const launcher = join(repo, ".hermes", "bin", "hermes.exe");
    const python = join(home, "tools", "python", "python.exe");
    touch(launcher);
    touch(python);
    touch(join(repo, "hermes_cli", "main.py"));
    childProcess.execFileSync.mockReturnValue(
      JSON.stringify([python, "-I", "-c", "bootstrap"]),
    );
    childProcess.execFile.mockImplementation((_python, _args, _options, callback) => callback(null, "Hermes test", ""));
    child.emit("close", 0);
    await installing;
    expect(installer.checkInstallStatus().installed).toBe(true);
    expect(installer.HERMES_PYTHON).toBe(python);
  },
);

// @lat: [[backend-installation#Fresh Windows bootstrap]]
it.skipIf(process.platform !== "win32")("validates a fresh bootstrap with no tools on PATH and recovers after failure", async () => {
  const { home, repo, touch } = fixture();
  vi.stubEnv("PATH", "");
  vi.stubEnv("TEMP", home);
  vi.stubEnv("TMP", home);
  const installer = await import("../src/main/installer");
  expect(installer.checkInstallStatus().installed).toBe(false);
  const child = () => Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
  });
  const failedChild = child();
  childProcess.spawn.mockReturnValue(failedChild);
  const first = installer.runInstall(() => {});
  const rejected = expect(first).rejects.toThrow("Installation failed");
  failedChild.emit("close", 1);
  await rejected;
  expect(installer.checkInstallStatus().installed).toBe(false);

  const nextChild = child();
  childProcess.spawn.mockReturnValue(nextChild);
  const progress: string[] = [];
  const next = installer.runInstall((p) => progress.push(p.log));
  const [exe, args, options] = childProcess.spawn.mock.calls.at(-1)!;
  expect(exe).toMatch(/(?:powershell|pwsh)\.exe$/);
  expect(args).toContain("-NonInteractive");
  const { readFileSync, existsSync } = await import("fs");
  const wrapper = args[args.indexOf("-File") + 1];
  const script = readFileSync(wrapper, "utf8");
  expect(script).toContain("-NonInteractive -HermesHome $hermesHome -InstallDir $installDir");
  expect(script).toContain(home.replace(/'/g, "''"));
  expect(script).toContain("UTF8Encoding $true");
  expect(options.env.HERMES_HOME).toBe(home);
  expect(options.stdio[0]).toBe("ignore");
  expect(options.windowsHide).toBe(true);
  const python = join(home, "managed-python", "python.exe");
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, ".hermes", "bin", "hermes.exe"));
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  childProcess.execFile.mockImplementation((_python, _args, _options, callback) => callback(null, "Hermes test", ""));
  nextChild.emit("close", 0);
  await next;
  expect(existsSync(wrapper)).toBe(false);
  expect(installer.checkInstallStatus().installed).toBe(true);
  expect(childProcess.execFile).toHaveBeenCalledWith(python, ["-I", "-c", "bootstrap", "--version"], expect.objectContaining({ env: expect.objectContaining({ HERMES_HOME: home }) }), expect.any(Function));
  expect(progress.at(-1)).toContain("Hermes runtime validated");
});

it.skipIf(process.platform !== "win32")("allows successful installation with an honest warning then validates a repaired retry", async () => {
  const { home, repo, touch } = fixture();
  vi.stubEnv("TEMP", home);
  vi.stubEnv("TMP", home);
  const installer = await import("../src/main/installer");
  const python = join(home, "managed-python", "python.exe");
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, ".hermes", "bin", "hermes.exe"));
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const broken of [true, false]) {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
      childProcess.spawn.mockReturnValue(child);
      childProcess.execFile.mockImplementation((_python, _args, _options, callback) => callback(broken ? new Error("missing dependencies") : null, "", ""));
      const logs: string[] = [];
      const installing = installer.runInstall((p) => logs.push(p.log));
      const result = expect(installing).resolves.toBeUndefined();
      child.emit("close", 0);
      await result;
      expect(logs.at(-1)).toContain(broken ? "Warning:" : "Hermes runtime validated");
      if (broken) expect(childProcess.execFile).toHaveBeenCalledTimes(3);
      expect(await installer.verifyInstall()).toBe(!broken);
    }
  } finally {
    warn.mockRestore();
  }
});

it.skipIf(process.platform !== "win32")("allows a zero-exit installer to proceed without claiming runtime validation", async () => {
  const { home } = fixture();
  vi.stubEnv("TEMP", home);
  vi.stubEnv("TMP", home);
  const installer = await import("../src/main/installer");
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  childProcess.spawn.mockReturnValue(child);
  const logs: string[] = [];
  const installing = installer.runInstall((p) => logs.push(p.log));
  child.emit("close", 0);
  await expect(installing).resolves.toBeUndefined();
  expect(logs.at(-1)).toContain("Warning:");
  expect(logs.at(-1)).not.toContain("Hermes runtime validated");
  expect(installer.checkInstallStatus().installed).toBe(false);
});

it.skipIf(process.platform !== "win32")("retries cold managed discovery and CLI validation in the same process", async () => {
  const { home, repo, touch } = fixture();
  const installer = await import("../src/main/installer");
  expect(installer.checkInstallStatus().installed).toBe(false);
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  childProcess.spawn.mockReturnValue(child);
  const logs: string[] = [];
  const installing = installer.runInstall((p) => logs.push(p.log));
  const python = join(home, "new-managed-runtime", "python.exe");
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, ".hermes", "bin", "hermes.exe"));
  childProcess.execFileSync.mockImplementationOnce(() => { throw new Error("cold discovery"); });
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  childProcess.execFile.mockImplementationOnce((_python, _args, _options, callback) => callback(new Error("cold import"), "", ""));
  childProcess.execFile.mockImplementation((_python, _args, _options, callback) => callback(null, "Hermes test", ""));
  child.emit("close", 0);
  await installing;
  expect(installer.HERMES_PYTHON).toBe(python);
  expect(installer.checkInstallStatus().installed).toBe(true);
  expect(childProcess.execFile).toHaveBeenCalledTimes(2);
  expect(logs.at(-1)).toContain("Hermes runtime validated");
});

it("does not cache failed CLI verification across an immediate retry", async () => {
  const { repo, touch } = fixture();
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"));
  touch(process.platform === "win32" ? join(repo, "venv", "Scripts", "hermes.exe") : join(repo, "hermes"));
  const installer = await import("../src/main/installer");
  childProcess.execFile.mockImplementationOnce((_python, _args, _options, callback) => callback(new Error("cold import"), "", ""));
  childProcess.execFile.mockImplementation((_python, _args, _options, callback) => callback(null, "Hermes test", ""));
  expect(await installer.verifyInstall()).toBe(false);
  expect(await installer.verifyInstall()).toBe(true);
  expect(childProcess.execFile).toHaveBeenCalledTimes(2);
});

it.skipIf(process.platform !== "win32")("preserves a nonzero installer failure even with existing binaries", async () => {
  const { repo, touch } = fixture();
  touch(join(repo, "venv", "Scripts", "python.exe"));
  touch(join(repo, "venv", "Scripts", "hermes.exe"));
  const installer = await import("../src/main/installer");
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  childProcess.spawn.mockReturnValue(child);
  const installing = installer.runInstall(() => {});
  const rejected = expect(installing).rejects.toThrow("Installation failed (exit code 1)");
  child.emit("close", 1);
  await rejected;
  expect(childProcess.execFile).not.toHaveBeenCalled();
});

it("retries failed managed discovery when the install gate is checked again", async () => {
  const { home, repo, touch } = fixture();
  const launcher = join(repo, ".hermes", "bin", process.platform === "win32" ? "hermes.exe" : "hermes");
  const python = join(home, "tools", "python.exe");
  touch(launcher);
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  childProcess.execFileSync.mockImplementationOnce(() => { throw new Error("runtime temporarily unavailable"); });
  const installer = await import("../src/main/installer");
  expect(installer.HERMES_PYTHON).toBe("");
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  expect(installer.checkInstallStatus().installed).toBe(true);
  expect(installer.HERMES_PYTHON).toBe(python);
  expect(installer.HERMES_HOME).toBe(home);
});

it("keeps an explicit home when portable extraction and inherited venv point elsewhere", async () => {
  const { home, repo, touch } = fixture();
  vi.stubEnv("PORTABLE_EXECUTABLE_DIR", join(home, "portable"));
  vi.stubEnv("PORTABLE_EXECUTABLE_FILE", join(home, "portable", "desktop.exe"));
  vi.stubEnv("VIRTUAL_ENV", join(home, "unrelated-venv"));
  const python = join(repo, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const script = process.platform === "win32" ? join(repo, ".venv", "Scripts/hermes.exe") : join(repo, "hermes");
  touch(python);
  touch(script);
  const installer = await import("../src/main/installer");
  expect(installer.HERMES_HOME).toBe(home);
  expect(installer.HERMES_REPO).toBe(repo);
  expect(installer.HERMES_PYTHON).toBe(python);
  expect(installer.checkInstallStatus().installed).toBe(true);
});

it.each(["portable", "installed"])("accepts the selected backend checkout in a %s app", async (kind) => {
  const { home, repo, touch } = fixture();
  vi.stubEnv("HERMES_HOME", repo);
  vi.stubEnv("PORTABLE_EXECUTABLE_DIR", kind === "portable" ? join(home, "portable") : "");
  const python = join(home, "tools", "python.exe");
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, ".hermes", "bin", process.platform === "win32" ? "hermes.exe" : "hermes"));
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  const installer = await import("../src/main/installer");
  expect(installer.HERMES_HOME).toBe(home);
  expect(installer.HERMES_REPO).toBe(repo);
  expect(installer.validateHermesHome(repo)).toBe(true);
  expect(installer.validateHermesHome(home)).toBe(true);
  expect(installer.checkInstallStatus().installed).toBe(true);
});

it.skipIf(process.platform !== "win32").each(["portable", "installed"])("discovers the default home from a %s app without shell overrides", async (kind) => {
  const { home, touch } = fixture();
  vi.stubEnv("HERMES_HOME", "");
  vi.stubEnv("LOCALAPPDATA", home);
  vi.stubEnv("PORTABLE_EXECUTABLE_DIR", kind === "portable" ? join(home, "portable") : "");
  const selectedHome = join(home, "hermes");
  const repo = join(selectedHome, "hermes-agent");
  const python = join(selectedHome, "tools", "python.exe");
  touch(python);
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, ".hermes", "bin", "hermes.exe"));
  childProcess.execFileSync.mockReturnValue(JSON.stringify([python, "-I", "-c", "bootstrap"]));
  const installer = await import("../src/main/installer");
  expect(installer.HERMES_HOME).toBe(selectedHome);
  expect(installer.checkInstallStatus().installed).toBe(true);
  expect(installer.validateHermesHome(selectedHome)).toBe(true);
  expect(installer.validateHermesHome(repo)).toBe(true);
});

it("reports Python import failures without logging arbitrary subprocess output", async () => {
  const { repo, touch } = fixture();
  touch(join(repo, "hermes_cli", "main.py"));
  touch(join(repo, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"));
  touch(process.platform === "win32" ? join(repo, "venv", "Scripts/hermes.exe") : join(repo, "hermes"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  childProcess.execFile.mockImplementation((_python, _args, _options, callback) => {
    callback(Object.assign(new Error("failed"), { code: 1 }), "private stdout", "private stderr\nModuleNotFoundError: No module named 'yaml'\n");
  });
  const installer = await import("../src/main/installer");
  expect(await installer.verifyInstall()).toBe(false);
  expect(warn).toHaveBeenCalledWith("[installer] Python CLI verification failed", expect.objectContaining({ code: 1, missingModule: "yaml" }));
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
  warn.mockRestore();
});

it("bootstraps Python snippets with managed dependencies", async () => {
  const { home, repo, touch } = fixture();
  touch(
    join(
      repo,
      ".hermes",
      "bin",
      process.platform === "win32" ? "hermes.exe" : "hermes",
    ),
  );
  const python = join(home, "python.exe");
  touch(python);
  childProcess.execFileSync.mockReturnValue(
    JSON.stringify([python, "-I", "-c", "bootstrap"]),
  );
  const installer = await import("../src/main/installer");
  const args = installer.hermesPythonArgs("import yaml; print('ok')", [
    "argument with spaces",
  ]);
  expect(args.slice(0, 2)).toEqual(["-I", "-c"]);
  expect(args[2]).toContain(JSON.stringify(repo));
  expect(args[2]).toContain("import hermes_bootstrap");
  expect(args[2]).toContain("import yaml; print('ok')");
  expect(args[3]).toBe("argument with spaces");
});

it.each(["venv", ".venv"])("keeps %s installations usable", async (venv) => {
  const { home, repo, touch } = fixture();
  const python = join(
    repo,
    venv,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const script =
    process.platform === "win32"
      ? join(repo, venv, "Scripts/hermes.exe")
      : join(repo, "hermes");
  touch(python);
  touch(script);
  touch(join(repo, "hermes_cli", "main.py"));
  const installer = await import("../src/main/installer");
  expect(installer.validateHermesHome(home)).toBe(true);
  expect(installer.HERMES_PYTHON).toBe(python);
  expect(installer.hermesCliArgs(["--version"])).toEqual(
    process.platform === "win32"
      ? ["-m", "hermes_cli.main", "--version"]
      : [script, "--version"],
  );
  expect(installer.hermesPythonArgs("print('ok')")).toEqual([
    "-c",
    "print('ok')",
  ]);
  expect(childProcess.execFileSync).not.toHaveBeenCalled();
});

it.each([
  "invalid JSON",
  "[]",
  '["relative-python", "-c", "bootstrap"]',
  '[123, "-c", "bootstrap"]',
])("rejects malformed runtime discovery: %s", async (output) => {
  const { home, repo, touch } = fixture();
  touch(
    join(
      repo,
      ".hermes",
      "bin",
      process.platform === "win32" ? "hermes.exe" : "hermes",
    ),
  );
  touch(
    join(
      repo,
      "venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  );
  childProcess.execFileSync.mockReturnValue(output);
  const installer = await import("../src/main/installer");
  expect(installer.validateHermesHome(home)).toBe(false);
  expect(installer.checkInstallStatus().installed).toBe(false);
});
