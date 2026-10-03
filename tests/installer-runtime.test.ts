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
    child.emit("close", 0);
    await installing;
    expect(installer.checkInstallStatus().installed).toBe(true);
    expect(installer.HERMES_PYTHON).toBe(python);
  },
);

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
