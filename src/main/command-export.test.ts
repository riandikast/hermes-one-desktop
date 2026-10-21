import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./installer", () => ({ HERMES_HOME: "unused" }));
import { exportCommand } from "./command-export";

let dir: string;
let destination: string;
const record = { id: "a", name: "Demo", command: "echo harmless", cwd: "", description: "", folder: "", createdAt: 1, updatedAt: 1 };
async function store(overrides = {}): Promise<void> {
  await writeFile(join(dir, "commands.json"), JSON.stringify([{ ...record, ...overrides }]));
}
beforeEach(async () => {
  dir = await mkdtemp(join(process.env.HERMES_TEST_TMPDIR || tmpdir(), "hermes-export-"));
  destination = join(dir, "selected folder");
  await mkdir(destination);
  await store();
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("Windows command launcher export", () => {
  it("writes CMD only, preserves Unicode and exact multiline command, escapes cwd", async () => {
    const command = "echo tiếng Việt\r\necho %PATH% & echo !literal!";
    await store({ name: "Tiếng Việt", command, cwd: "C:\\A & B\\100% !" });
    const result = await exportCommand({ id: "a", destination }, "cmd", dir);
    const text = await readFile(result.path, "utf8");
    expect(text).toContain(command);
    expect(text).toContain('pushd "C:\\A & B\\100%% !" || exit /b 1');
    expect(text).not.toMatch(/powershell|\.ps1|executionpolicy/i);
    expect(await readdir(destination)).toEqual(["Tiếng Việt.cmd"]);
  });
  it("marks PowerShell dependency, keeps syntax in BOM companion, never bypasses policy", async () => {
    const command = "$x = '✓'\nWrite-Output $x";
    await store({ command, cwd: "C:\\O'Brien" });
    const result = await exportCommand({ id: "a", destination }, "powershell", dir);
    expect(result.path).toContain(".powershell.cmd");
    expect(await readFile(join(destination, "Demo.powershell.ps1"), "utf8")).toBe(`\ufeffSet-Location -LiteralPath 'C:\\O''Brien' -ErrorAction Stop\r\n${command}`);
    expect(await readFile(result.path, "utf8")).toContain('-NoProfile -File "%~dp0Demo.powershell.ps1"');
    expect(await readFile(result.path, "utf8")).not.toMatch(/bypass|encodedcommand/i);
  });
  it("normalizes hostile names and never overwrites a collision", async () => {
    await store({ name: "../CON" });
    const first = await exportCommand({ id: "a", destination }, "cmd", dir);
    await writeFile(first.path, "keep");
    const second = await exportCommand({ id: "a", destination }, "cmd", dir);
    expect(second.path).toBe(join(destination, ".._CON (1).cmd"));
    expect(await readFile(first.path, "utf8")).toBe("keep");
    await store({ name: "CON" });
    expect((await exportCommand({ id: "a", destination }, "cmd", dir)).path).toBe(join(destination, "_CON.cmd"));
  });
  it("rejects traversal, relative paths, extra payload, missing template, injected cwd", async () => {
    for (const payload of [{ id: "a", destination: "relative" }, { id: "a", destination: `${destination}/../escape` }, { id: "a", destination, command: "extra" }, { id: "missing", destination }]) {
      await expect(exportCommand(payload, "cmd", dir)).rejects.toThrow();
    }
    await store({ cwd: 'C:\\ok"\r\necho injected' });
    await expect(exportCommand({ id: "a", destination }, "cmd", dir)).rejects.toThrow();
    expect(await readdir(destination)).toEqual([]);
  });
  it("reports save failure and removes only its own PowerShell companion", async () => {
    await mkdir(join(destination, "Demo.powershell.cmd"));
    const result = await exportCommand({ id: "a", destination }, "powershell", dir);
    expect(result.path).toContain("Demo (1).powershell.cmd");
    expect(await readdir(destination)).not.toContain("Demo.powershell.ps1");
    await expect(exportCommand({ id: "a", destination: join(dir, "absent") }, "cmd", dir)).rejects.toThrow("Could not save");
  });
  it.skipIf(process.platform !== "win32")("executes harmless CMD fixture with Unicode cwd and no PowerShell", async () => {
    const cwd = join(dir, "Việt & 100% !");
    await mkdir(cwd);
    await store({ cwd, command: 'echo harmless>"result.txt"\r\necho tiếng Việt>>"result.txt"' });
    const { path } = await exportCommand({ id: "a", destination }, "cmd", dir);
    const result = spawnSync(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", ["/d", "/v:off", "/s", "/c", `""${path}""`], { windowsVerbatimArguments: true, input: "\r\n", encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(cwd, "result.txt"), "utf8")).toContain("tiếng Việt");
  });
});
