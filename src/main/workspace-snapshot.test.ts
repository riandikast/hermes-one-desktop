// @vitest-environment node
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs/promises";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { isAbsolute, join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as gitRunner from "./git";
import { captureWorkspaceSnapshot } from "./workspace-snapshot";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
let scratch: string;
let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, {
  cwd: repo, encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 10_000,
});
const put = (name: string, bytes: string | Buffer): Promise<void> => writeFile(join(repo, name), bytes);
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
beforeEach(async () => {
  const base = process.env.TMPDIR || (process.platform === "win32"
    ? join(homedir(), "AppData", "Local", "hermes", "cache", "scratch") : tmpdir());
  await mkdir(base, { recursive: true });
  scratch = await mkdtemp(join(base, "workspace-snapshot-"));
  repo = join(scratch, "repo"); await mkdir(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  git("config", "core.autocrlf", "false");
  for (const name of ["clean.txt", "dirty.txt", "unchanged-dirty.txt", "deleted.txt"]) await put(name, "base\n");
  await put(".gitignore", "ignored/\n");
  git("add", "."); git("commit", "-qm", "baseline");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("hashes actual bytes: clean edit, pre-dirty edit again, staged/untracked/deleted; unchanged dirt stays equal", async () => {
  await put("dirty.txt", "already dirty\n"); await put("unchanged-dirty.txt", "unrelated dirt\n");
  const before = await captureWorkspaceSnapshot(repo);
  expect(before.root).toBe(await realpath(repo)); expect(before.warning).toBeUndefined();
  execFileSync(process.execPath, ["-e", "const fs = require('node:fs'); fs.writeFileSync('clean.txt', 'new\\r\\n'); fs.writeFileSync('dirty.txt', 'dirty again\\n');"], {
    cwd: repo, windowsHide: true, stdio: "pipe", timeout: 10_000,
  }); // Real script-driven edits, not file-tool events.
  await put("staged.txt", "staged\n"); git("add", "staged.txt");
  await mkdir(join(repo, "nested")); await put("nested/new.txt", "nested\n");
  await mkdir(join(repo, "ignored")); await put("ignored/no.txt", "ignored\n");
  await rm(join(repo, "deleted.txt"));
  const index = await readFile(join(repo, ".git", "index"));
  const after = await captureWorkspaceSnapshot(repo);
  expect(after.root).toBe(before.root); expect(after.warning).toBeUndefined();
  expect(await readFile(join(repo, ".git", "index"))).toEqual(index);
  expect(after.files.every((file) => isAbsolute(file.path))).toBe(true);
  const old = new Map(before.files.map((file) => [file.path, file.fingerprint]));
  const next = new Map(after.files.map((file) => [file.path, file.fingerprint]));
  const changed = [...new Set([...old.keys(), ...next.keys()])].filter((path) => old.get(path) !== next.get(path));
  expect(changed.sort()).toEqual(["clean.txt", "dirty.txt", "staged.txt", "nested/new.txt", "deleted.txt"].map((name) => join(before.root!, name)).sort());
  expect(after.files.find((file) => file.path === join(after.root!, "clean.txt"))).toEqual({
    path: join(after.root!, "clean.txt"), fingerprint: hash("new\r\n"), content: "new\r\n",
  });
});

it("scopes enumeration to the canonical attached subfolder, including literal pathspec characters", async () => {
  const folder = join(repo, "[attached]"); await mkdir(folder);
  await writeFile(join(folder, "inside.txt"), "inside\n");
  await mkdir(join(repo, "a")); await put("a/outside.txt", "outside\n");
  const result = await captureWorkspaceSnapshot(folder);
  expect(result.root).toBe(await realpath(folder));
  expect(result.files.map((file) => file.path)).toEqual([join(result.root!, "inside.txt")]);
});

it("hashes binary/invalid UTF-8 with null text; preserves BOM, empty text and CRLF exactly", async () => {
  const fixtures = new Map<string, Buffer>([
    ["binary.bin", Buffer.from([0, 1, 2])], ["invalid.txt", Buffer.from([0xc3, 0x28])],
    ["bom.txt", Buffer.from("\uFEFFhello\r\n")], ["empty.txt", Buffer.alloc(0)],
  ]);
  for (const [name, bytes] of fixtures) await put(name, bytes);
  const result = await captureWorkspaceSnapshot(repo);
  for (const [name, bytes] of fixtures) {
    const file = result.files.find((entry) => entry.path === join(result.root!, name));
    expect(file?.fingerprint).toBe(hash(bytes));
    expect(file?.content).toBe(name === "binary.bin" || name === "invalid.txt" ? null : bytes.toString("utf8"));
  }
});

it("excludes sensitive names and oversized files without losing safe coverage", async () => {
  const names = [".env", ".env.local", "credentials.json", "id_rsa", "private-key.txt", "cert.pem", "auth.json"];
  for (const name of names) await put(name, "synthetic fixture only\n");
  await put("oversize.bin", Buffer.alloc(256 * 1024 + 1));
  const reads = vi.spyOn(fs, "open");
  const result = await captureWorkspaceSnapshot(repo);
  expect(result.root).toBe(await realpath(repo));
  expect(result.excludedPaths?.sort()).toEqual([...names, "oversize.bin"].map((name) => join(result.root!, name)).sort());
  expect(result.warning).toContain("7 sensitive"); expect(result.warning).toContain("1 over 256 KiB");
  expect(result.files.some((file) => file.path.endsWith("clean.txt"))).toBe(true);
  expect(result.files.some((file) => result.excludedPaths?.includes(file.path))).toBe(false);
  expect(reads.mock.calls.some(([path]) => result.excludedPaths?.includes(String(path)))).toBe(false);
});

it("excludes unreadable regular files instead of reporting false deletions", async () => {
  const actualOpen = (await vi.importActual<typeof import("fs/promises")>("fs/promises")).open;
  vi.spyOn(fs, "open").mockImplementation((...args) => {
    if (String(args[0]) === join(repo, "clean.txt")) {
      return Promise.reject(Object.assign(new Error("denied fixture"), { code: "EACCES" }));
    }
    return actualOpen(...args);
  });
  const result = await captureWorkspaceSnapshot(repo);
  expect(result.root).toBe(await realpath(repo));
  expect(result.excludedPaths).toContain(join(result.root!, "clean.txt"));
  expect(result.warning).toContain("1 unreadable");
});

it("rejects symlink/junction escapes, including an ancestor of a tracked file", async () => {
  const outside = join(scratch, "outside"); await mkdir(outside);
  await writeFile(join(outside, "escape.txt"), "outside fixture\n");
  await mkdir(join(repo, "nested")); await put("nested/escape.txt", "tracked\n"); git("add", "nested/escape.txt");
  await rm(join(repo, "nested"), { recursive: true });
  await symlink(outside, join(repo, "nested"), process.platform === "win32" ? "junction" : "dir");
  const result = await captureWorkspaceSnapshot(repo);
  expect(result.root).toBe(await realpath(repo)); expect(result.warning).toContain("symlink");
  expect(result.excludedPaths).toContain(join(result.root!, "nested", "escape.txt"));
  expect(result.files.some((file) => file.content === "outside fixture\n")).toBe(false);
  const alias = join(scratch, "alias");
  await symlink(repo, alias, process.platform === "win32" ? "junction" : "dir");
  expect((await captureWorkspaceSnapshot(alias)).root).toBeNull();
});

it("omits submodule directories, not their foreign working-tree contents", async () => {
  const head = git("rev-parse", "HEAD").trim();
  git("update-index", "--add", "--cacheinfo", `160000,${head},submodule`);
  await mkdir(join(repo, "submodule")); await put("submodule/foreign.txt", "foreign\n");
  const result = await captureWorkspaceSnapshot(repo);
  expect(result.root).not.toBeNull(); expect(result.excludedPaths).toContain(join(result.root!, "submodule"));
  expect(result.files.some((file) => file.path.includes(`${join(repo, "submodule")}`))).toBe(false);
});

it("returns quiet nonrepo, rejects relative/missing scopes, and fails closed on Git command failure", async () => {
  expect(await captureWorkspaceSnapshot(scratch)).toEqual({ root: null, files: [] });
  expect((await captureWorkspaceSnapshot(".")).warning).toBeTruthy();
  expect((await captureWorkspaceSnapshot(join(scratch, "missing"))).root).toBeNull();
  const spy = vi.spyOn(gitRunner, "runGit").mockResolvedValueOnce({ code: -1, stdout: "", stderr: "timeout" });
  expect(await captureWorkspaceSnapshot(repo)).toEqual({ root: null, files: [], warning: expect.stringContaining("Git discovery failed") });
  spy.mockRestore();
  const realRun = gitRunner.runGit;
  vi.spyOn(gitRunner, "runGit").mockImplementation((dir, args, timeout) => {
    expect(args).toContain("--no-optional-locks"); expect(timeout).toBe(10_000);
    return args.includes("ls-files") ? Promise.resolve({ code: -1, stdout: "partial.txt\0", stderr: "timeout" }) : realRun(dir, args, timeout);
  });
  expect((await captureWorkspaceSnapshot(repo)).root).toBeNull();
});

it("records newly ignored untracked paths as excluded, not deleted", async () => {
  await mkdir(join(repo, "generated"));
  await put("generated/result.txt", "existing untracked\n");
  const before = await captureWorkspaceSnapshot(repo);
  expect(before.files.some((file) => file.path.endsWith("result.txt"))).toBe(true);
  await put(".gitignore", "ignored/\ngenerated/\n");
  const after = await captureWorkspaceSnapshot(repo);
  expect(after.excludedPaths).toContain(join(repo, "generated"));
  expect(after.files.some((file) => file.path.endsWith("result.txt"))).toBe(false);
});

it("fails closed above 5000 enumerated paths", async () => {
  for (let start = 0; start < 5001; start += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 5001 - start) }, (_, index) => put(`cap-${start + index}.txt`, "")));
  }
  const result = await captureWorkspaceSnapshot(repo);
  expect(result).toEqual({ root: null, files: [], warning: expect.stringContaining("5000 paths") });
});

it("fails closed above 16 MiB aggregate reads; exactly 256 KiB files remain eligible", async () => {
  const bytes = Buffer.alloc(256 * 1024, 65);
  for (let i = 0; i < 65; i++) await put(`large-${String(i).padStart(2, "0")}.txt`, bytes);
  expect(await captureWorkspaceSnapshot(repo)).toEqual({ root: null, files: [], warning: expect.stringContaining("16 MiB") });
});
