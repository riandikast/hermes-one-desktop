// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as runner from "./git";
import { gitStashList, mutate } from "./git-stash";
import { gitStashFiles, gitStashFileDiff, gitStashRestoreFiles, gitStashDeleteFiles } from "./git-stash-files";
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
const put = (path: string, content: string): Promise<void> => writeFile(join(repo, path), content);
const read = (path: string): Promise<string> => readFile(join(repo, path), "utf8");
const hashes = async (): Promise<string[]> => {
  const list = await gitStashList(repo); expect(list.ok, list.error).toBe(true);
  return list.entries.map((entry) => entry.hash);
};
const save = (): string => { git("stash", "push", "-qu", "-m", "fixture"); return git("rev-parse", "refs/stash").trim(); };
beforeEach(async () => {
  const scratch = process.platform === "win32" ? join(homedir(), "AppData", "Local", "hermes", "cache", "scratch") : process.env.TMPDIR || tmpdir();
  await mkdir(scratch, { recursive: true }); repo = await mkdtemp(join(scratch, "stash-files-test-"));
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com"); git("config", "core.autocrlf", "false");
  for (const path of ["edit.txt", "delete.txt", "keep.txt", "third.txt", "[literal].txt"]) await put(path, `${path} base\n`);
  await put(".gitignore", "ignored.txt\n"); git("add", "."); git("commit", "-qm", "base");
});
afterEach(async () => { vi.restoreAllMocks(); await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

it("restores only selected tracked edits, deletions and untracked payload; index/stash/unrelated files unchanged", async () => {
  await put("edit.txt", "selected edit\n"); await rm(join(repo, "delete.txt")); await put("new.txt", "selected untracked\n"); await put("keep.txt", "saved unrelated\n");
  const hash = save(); const index = git("write-tree"); const originalKeep = await read("keep.txt");
  const list = await gitStashFiles(repo, hash); expect(list.ok, list.error).toBe(true);
  expect(list.files).toEqual(expect.arrayContaining([{ path: "edit.txt", status: "M" }, { path: "delete.txt", status: "D" }, { path: "new.txt", status: "?" }]));
  const diff = await gitStashFileDiff(repo, hash, "new.txt"); expect(diff.ok, diff.error).toBe(true); expect(diff.output).toContain("+selected untracked"); expect(diff.output).not.toContain("selected edit");
  const result = await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt", "delete.txt", "new.txt"] }]); expect(result.ok, result.error).toBe(true);
  expect(await read("edit.txt")).toBe("selected edit\n"); expect(await read("new.txt")).toBe("selected untracked\n"); await expect(read("delete.txt")).rejects.toThrow();
  expect(await read("keep.txt")).toBe(originalKeep); expect(git("write-tree")).toBe(index); expect(await hashes()).toEqual([hash]);
});

it("deletes selected saved files from worktree/index/untracked trees while preserving every unselected payload and base", async () => {
  await put("edit.txt", "selected index\n"); await put("keep.txt", "keep index\n"); git("add", "edit.txt", "keep.txt");
  await put("edit.txt", "selected work\n"); await put("keep.txt", "keep work\n"); await rm(join(repo, "delete.txt")); await put("new.txt", "remove new\n"); await put("keep-new.txt", "keep new\n");
  const old = save(); const oldBase = git("rev-parse", `${old}^1`); const index = git("write-tree"); const work = git("status", "--porcelain");
  const result = await gitStashDeleteFiles(repo, [{ hash: old, paths: ["edit.txt", "delete.txt", "new.txt"] }]); expect(result.ok, result.error).toBe(true);
  const [replacement] = await hashes(); expect(replacement).not.toBe(old); expect(result.output).toContain(replacement); expect(git("rev-parse", `${replacement}^1`)).toBe(oldBase);
  expect(git("show", `${replacement}:edit.txt`)).toBe("edit.txt base\n"); expect(git("show", `${replacement}^2:edit.txt`)).toBe("edit.txt base\n"); expect(git("show", `${replacement}:delete.txt`)).toBe("delete.txt base\n");
  expect(git("show", `${replacement}:keep.txt`)).toBe("keep work\n"); expect(git("show", `${replacement}^2:keep.txt`)).toBe("keep index\n"); expect(git("show", `${replacement}^3:keep-new.txt`)).toBe("keep new\n");
  expect(git("ls-tree", "-r", "--name-only", `${replacement}^3`)).not.toContain("\nnew.txt"); expect(git("ls-tree", "-r", "--name-only", `${replacement}^3`)).toBe("keep-new.txt\n");
  expect((await gitStashFiles(repo, replacement)).files.map((file) => file.path).sort()).toEqual(["keep-new.txt", "keep.txt"]);
  expect(git("write-tree")).toBe(index); expect(git("status", "--porcelain")).toBe(work); expect(await read("keep.txt")).toBe("keep.txt base\n");
});

it("drops only last-file stash, resolving refs after renumbering; delete normalizes repeated hash blocks", async () => {
  await put("edit.txt", "A\n"); await put("third.txt", "A third\n"); const a = save(); await put("keep.txt", "B\n"); const b = save();
  const result = await gitStashDeleteFiles(repo, [{ hash: a, paths: ["edit.txt"] }, { hash: b, paths: ["keep.txt"] }, { hash: a, paths: ["third.txt"] }]);
  expect(result.ok, result.error).toBe(true); expect(await hashes()).toEqual([]); expect(result.output).toContain("stash removed");
});

it("preserves true restore order across repeated hash blocks and reports a conflict stop without applying later files", async () => {
  await put("edit.txt", "A edit\n"); await put("third.txt", "A third\n"); const a = save(); await put("keep.txt", "B keep\n"); const b = save();
  const result = await gitStashRestoreFiles(repo, [{ hash: a, paths: ["edit.txt"] }, { hash: b, paths: ["keep.txt"] }, { hash: a, paths: ["third.txt"] }]);
  expect(result.ok, result.error).toBe(true); expect(result.output?.split("\n")).toEqual([`Restored ${a}: edit.txt`, `Restored ${b}: keep.txt`, `Restored ${a}: third.txt`]);
  git("reset", "--hard", "HEAD"); await put("edit.txt", "C conflict\n"); const c = save();
  const stop = await gitStashRestoreFiles(repo, [{ hash: a, paths: ["edit.txt"] }, { hash: c, paths: ["edit.txt"] }, { hash: b, paths: ["keep.txt"] }]);
  expect(stop.ok).toBe(false); expect(stop.error).toContain("1 files restored"); expect(await read("edit.txt")).toBe("A edit\n"); expect(await read("keep.txt")).toBe("keep.txt base\n"); expect(await hashes()).toEqual([c, b, a]);
});

it("dirty index/worktree, untracked, ignored collision and changed base fail closed", async () => {
  await put("edit.txt", "saved\n"); await put("ignored.txt", "saved ignored name\n"); git("add", "-f", "ignored.txt"); const hash = save();
  for (const staged of [false, true]) {
    await put("keep.txt", "local keep\n"); if (staged) git("add", "keep.txt");
    const before = git("write-tree"); const result = await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt"] }]); expect(result.ok).toBe(false); expect(await read("keep.txt")).toBe("local keep\n"); expect(git("write-tree")).toBe(before); git("reset", "--hard", "HEAD");
  }
  await put("unrelated.txt", "precious\n"); expect((await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt"] }])).ok).toBe(false); await rm(join(repo, "unrelated.txt"));
  await put("ignored.txt", "precious ignored\n"); expect((await gitStashRestoreFiles(repo, [{ hash, paths: ["ignored.txt"] }])).ok).toBe(false); expect(await read("ignored.txt")).toBe("precious ignored\n"); await rm(join(repo, "ignored.txt"));
  await put("edit.txt", "new HEAD\n"); git("add", "edit.txt"); git("commit", "-qm", "changed base"); expect((await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt"] }])).ok).toBe(false); expect(await read("edit.txt")).toBe("new HEAD\n"); expect(await hashes()).toEqual([hash]);
});

it("validates all hashes/paths before mutations, uses literal pathspecs and rejects symlink ancestors", async () => {
  await put("edit.txt", "saved\n"); await put("[literal].txt", "literal\n"); await mkdir(join(repo, "folder")); await put("folder/saved.txt", "nested\n"); const hash = save();
  for (const bad of ["../escape", "/absolute", "C:/absolute", ".git/config", "a\\b", ":(glob)*", "folder", "edit.txt\0x"]) {
    const input = [{ hash, paths: ["edit.txt"] }, { hash, paths: [bad] }];
    expect((await gitStashDeleteFiles(repo, input)).ok).toBe(false); expect((await gitStashRestoreFiles(repo, input)).ok).toBe(false);
  }
  for (const bad of ["stash@{0}", "--all", hash.slice(0, 8), git("rev-parse", "HEAD").trim(), "a".repeat(40)]) {
    expect((await gitStashDeleteFiles(repo, [{ hash, paths: ["edit.txt"] }, { hash: bad, paths: ["edit.txt"] }])).ok).toBe(false);
  }
  expect(await hashes()).toEqual([hash]); expect(await read("edit.txt")).toBe("edit.txt base\n");
  await mkdir(join(repo, "target")); await symlink(join(repo, "target"), join(repo, "folder"), process.platform === "win32" ? "junction" : "dir");
  expect((await gitStashDeleteFiles(repo, [{ hash, paths: ["folder/saved.txt"] }])).ok).toBe(false); expect((await gitStashRestoreFiles(repo, [{ hash, paths: ["folder/saved.txt"] }])).ok).toBe(false);
  const diff = await gitStashFileDiff(repo, hash, "[literal].txt"); expect(diff.ok, diff.error).toBe(true); expect(diff.output).toContain("+literal"); expect(diff.output).not.toContain("+saved");
  expect((await gitStashRestoreFiles(repo, [{ hash, paths: ["[literal].txt"] }])).ok).toBe(true); expect(await read("[literal].txt")).toBe("literal\n");
});

it("stores and verifies replacement before dropping original; failed store leaves original safely saved", async () => {
  await put("edit.txt", "remove\n"); await put("keep.txt", "keep\n"); const hash = save();
  const run = runner.runGit; const calls: string[][] = [];
  vi.spyOn(runner, "runGit").mockImplementation(async (dir, args, timeout) => { calls.push(args); if (args[0] === "stash" && args[1] === "store") return { code: 1, stdout: "", stderr: "injected store failure" }; return run(dir, args, timeout); });
  const result = await gitStashDeleteFiles(repo, [{ hash, paths: ["edit.txt"] }]); expect(result.ok).toBe(false); expect(result.error).toContain("injected store failure"); expect(await hashes()).toEqual([hash]); expect(calls.some((args) => args[0] === "stash" && args[1] === "drop")).toBe(false);
});

it("diffs/restores index-only changes without silently succeeding; removes index-only and untracked-only saved payload", async () => {
  await put("edit.txt", "index-only version\n"); git("add", "edit.txt"); await put("edit.txt", "edit.txt base\n");
  await put("keep.txt", "keep saved\n"); await put("new.txt", "saved new\n"); const hash = save();
  expect((await gitStashFiles(repo, hash)).files).toContainEqual({ path: "edit.txt", status: "M" });
  const diff = await gitStashFileDiff(repo, hash, "edit.txt"); expect(diff.ok, diff.error).toBe(true); expect(diff.output).toContain("+index-only version");
  const index = git("write-tree"); const restored = await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt"] }]); expect(restored.ok, restored.error).toBe(true); expect(await read("edit.txt")).toBe("index-only version\n"); expect(git("write-tree")).toBe(index);
  git("reset", "--hard", "HEAD");
  const removedIndex = await gitStashDeleteFiles(repo, [{ hash, paths: ["edit.txt"] }]); expect(removedIndex.ok, removedIndex.error).toBe(true);
  const [second] = await hashes(); expect(git("rev-parse", `${second}^{tree}`)).toBe(git("rev-parse", `${hash}^{tree}`)); expect(git("show", `${second}^2:edit.txt`)).toBe("edit.txt base\n");
  const removedNew = await gitStashDeleteFiles(repo, [{ hash: second, paths: ["new.txt"] }]); expect(removedNew.ok, removedNew.error).toBe(true);
  const [third] = await hashes(); expect(git("rev-parse", `${third}^{tree}`)).toBe(git("rev-parse", `${second}^{tree}`)); expect(git("ls-tree", "-r", "--name-only", `${third}^3`)).toBe(""); expect(git("show", `${third}:keep.txt`)).toBe("keep saved\n");
});

it("stops at existing Git operations and conflicts without touching worktree or saved copies", async () => {
  await put("edit.txt", "saved\n"); const hash = save(); await writeFile(join(repo, ".git", "MERGE_HEAD"), git("rev-parse", "HEAD"));
  const result = await gitStashRestoreFiles(repo, [{ hash, paths: ["edit.txt"] }]); expect(result.ok).toBe(false); expect(result.error).toContain("active Git operation"); expect(await read("edit.txt")).toBe("edit.txt base\n"); expect(await hashes()).toEqual([hash]);
});

it("shares the existing stash mutation lock", async () => {
  const result = await mutate(() => gitStashDeleteFiles(repo, [])); expect(result.ok).toBe(false); expect(result.error).toContain("already in progress");
});
