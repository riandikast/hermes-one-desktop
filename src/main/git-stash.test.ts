// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import * as runner from "./git";
import { gitStashList, gitStashCreate, gitStashApply, gitStashDrop, gitStashDiff } from "./git-stash";

let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
const put = (path: string, text: string): Promise<void> => writeFile(join(repo, path), text);
const read = (path: string): Promise<string> => readFile(join(repo, path), "utf8");
const hashes = async (): Promise<string[]> => {
  const list = await gitStashList(repo);
  expect(list.ok, list.error).toBe(true);
  return list.entries.map((entry) => entry.hash);
};
const stash = async (path: string, text: string): Promise<string> => {
  await put(path, text);
  const result = await gitStashCreate(repo, [path]);
  expect(result.ok, result.error).toBe(true);
  return (await hashes())[0];
};
beforeEach(async () => {
  const scratch = process.platform === "win32" ? join(homedir(), "AppData", "Local", "hermes", "cache", "scratch") : process.env.TMPDIR || tmpdir();
  await mkdir(scratch, { recursive: true });
  repo = await mkdtemp(join(scratch, "git-stash-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  git("config", "core.autocrlf", "false");
  await put("file.txt", "base\n"); await put("other.txt", "other base\n");
  git("add", "."); git("commit", "-qm", "base");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("lists immutable hashes, refs and subjects; empty lists are successful", async () => {
  expect(await gitStashList(repo)).toEqual({ ok: true, entries: [] });
  const older = await stash("file.txt", "older\n");
  const newer = await stash("other.txt", "newer\n");
  const list = await gitStashList(repo);
  expect(list.entries.map(({ hash, ref }) => ({ hash, ref }))).toEqual([
    { hash: newer, ref: "stash@{0}" }, { hash: older, ref: "stash@{1}" },
  ]);
  expect(list.entries.every((entry) => entry.subject.includes("Selected files"))).toBe(true);
});

it("stashes selected staged AND unstaged versions without capturing unrelated staged files", async () => {
  await put("file.txt", "selected staged\n"); git("add", "file.txt");
  await put("file.txt", "selected unstaged\n");
  await put("other.txt", "other staged\n"); git("add", "other.txt");
  await put("other.txt", "other unstaged\n");
  await put("untouched.txt", "untracked keep\n");
  const result = await gitStashCreate(repo, ["file.txt"]);
  expect(result.ok, result.error).toBe(true);
  const hash = (await hashes())[0];
  expect(git("show", `${hash}:file.txt`)).toBe("selected unstaged\n");
  expect(git("show", `${hash}^2:file.txt`)).toBe("selected staged\n");
  expect(git("show", `${hash}:other.txt`)).toBe("other base\n");
  expect(git("show", `${hash}^2:other.txt`)).toBe("other base\n");
  expect(await read("file.txt")).toBe("base\n");
  expect(await read("other.txt")).toBe("other unstaged\n");
  expect(git("show", ":other.txt")).toBe("other staged\n");
  expect(await read("untouched.txt")).toBe("untracked keep\n");
  expect(git("diff", "--cached", "--name-only").trim()).toBe("other.txt");
});

it("captures literal untracked and newly staged names, includes untracked diff, excludes ignored files", async () => {
  await put(".git/info/exclude", "ignored.txt\n");
  await put("ignored.txt", "ignored keep\n");
  await put("[a].txt", "literal untracked\n");
  await put("a.txt", "not selected\n");
  await put("-new.txt", "new staged\n"); git("add", "--", "-new.txt");
  const result = await gitStashCreate(repo, ["[a].txt", "-new.txt"]);
  expect(result.ok, result.error).toBe(true);
  const hash = (await hashes())[0];
  expect(git("show", `${hash}^3:[a].txt`)).toBe("literal untracked\n");
  expect(git("show", `${hash}^2:-new.txt`)).toBe("new staged\n");
  await expect(read("[a].txt")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(read("-new.txt")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await read("a.txt")).toBe("not selected\n");
  expect(await read("ignored.txt")).toBe("ignored keep\n");
  expect(git("diff", "--cached", "--name-only")).toBe("");
  const diff = await gitStashDiff(repo, hash);
  expect(diff.ok, diff.error).toBe(true);
  expect(diff.output).toContain("+literal untracked");
  expect(diff.output).toContain("+new staged");
  expect(diff.output).not.toContain("ignored keep");
  expect((await gitStashCreate(repo, ["ignored.txt"])).ok).toBe(false);
});

it("validates full batches before mutation; rejects directories, traversal, refs, arbitrary commits and ignored paths", async () => {
  const hash = await stash("file.txt", "saved\n");
  await put("file.txt", "dirty keep\n");
  await mkdir(join(repo, "folder")); await put("folder/file.txt", "nested\n");
  for (const paths of [[], ["file.txt", "../escape"], ["/absolute"], ["C:/absolute"], [".git/config"], ["folder"], ["a\\b"], [":(glob)*"], ["file.txt\0x"]]) {
    expect((await gitStashCreate(repo, paths)).ok).toBe(false);
  }
  expect(await read("file.txt")).toBe("dirty keep\n");
  const head = git("rev-parse", "HEAD").trim();
  for (const bad of ["stash@{0}", "--all", hash.slice(0, 8), head, "a".repeat(40)]) {
    expect((await gitStashDiff(repo, bad)).ok).toBe(false);
    expect((await gitStashApply(repo, [hash, bad])).ok).toBe(false);
    expect((await gitStashDrop(repo, [hash, bad])).ok).toBe(false);
  }
  expect((await gitStashDrop(repo, [hash, hash])).ok).toBe(false);
  expect(await hashes()).toEqual([hash]);
});

it("stashes staged-only files and tracked deletions without changing HEAD", async () => {
  const head = git("rev-parse", "HEAD");
  await put("file.txt", "staged only\n"); git("add", "file.txt");
  await rm(join(repo, "other.txt"));
  const result = await gitStashCreate(repo, ["file.txt", "other.txt"]);
  expect(result.ok, result.error).toBe(true);
  const hash = (await hashes())[0];
  expect(git("show", `${hash}:file.txt`)).toBe("staged only\n");
  expect(git("show", `${hash}^2:file.txt`)).toBe("staged only\n");
  expect(git("ls-tree", hash, "other.txt")).toBe("");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("status", "--porcelain")).toBe("");
  expect(await read("file.txt")).toBe("base\n");
  expect(await read("other.txt")).toBe("other base\n");
});

it("rejects symlink ancestors without touching their contents", async () => {
  const target = join(repo, "target");
  await mkdir(target); await put("target/precious.txt", "keep\n");
  await symlink(target, join(repo, "alias"), process.platform === "win32" ? "junction" : "dir");
  expect((await gitStashCreate(repo, ["alias/precious.txt"])).ok).toBe(false);
  expect((await gitStashCreate(repo, ["alias"])).ok).toBe(false);
  expect(await read("target/precious.txt")).toBe("keep\n");
  expect(await hashes()).toEqual([]);
});

it("refuses staged deletions and rename source paths before changing data", async () => {
  git("rm", "-q", "other.txt");
  git("mv", "file.txt", "renamed.txt");
  const before = git("status", "--porcelain");
  for (const paths of [["other.txt"], ["file.txt", "renamed.txt"]]) {
    const result = await gitStashCreate(repo, paths);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Staged deletions");
    expect(git("status", "--porcelain")).toBe(before);
    expect(await read("renamed.txt")).toBe("base\n");
    expect(git("show", ":renamed.txt")).toBe("base\n");
    expect(await hashes()).toEqual([]);
  }
});

it("preserves data on failures before save and reports saved hash if real-index cleanup fails", async () => {
  await put("file.txt", "selected staged\n"); git("add", "file.txt");
  await put("file.txt", "selected worktree\n");
  const realRun = runner.runGit;
  const spy = vi.spyOn(runner, "runGit").mockImplementation((dir, args, timeout) => {
    if (args.includes("reset")) return Promise.resolve({ code: 1, stdout: "", stderr: "private index failure" });
    return realRun(dir, args, timeout);
  });
  expect((await gitStashCreate(repo, ["file.txt"])).ok).toBe(false);
  expect(await read("file.txt")).toBe("selected worktree\n");
  expect(git("show", ":file.txt")).toBe("selected staged\n");
  expect(await hashes()).toEqual([]);
  spy.mockImplementation((dir, args, timeout) => {
    if (args.includes("restore")) return Promise.resolve({ code: 1, stdout: "", stderr: "real index lock failure" });
    return realRun(dir, args, timeout);
  });
  const result = await gitStashCreate(repo, ["file.txt"]);
  const hash = (await hashes())[0];
  expect(result.ok).toBe(false);
  expect(result.error).toContain(`Stash saved as ${hash}`);
  expect(result.error).toContain("real index lock failure");
  expect(git("show", `${hash}:file.txt`)).toBe("selected worktree\n");
  expect(git("show", `${hash}^2:file.txt`)).toBe("selected staged\n");
  expect(git("show", ":file.txt")).toBe("selected staged\n");
  expect(await read("file.txt")).toBe("base\n");
});

it("applies ordered nonoverlapping batches, retaining all stashes", async () => {
  const first = await stash("file.txt", "first\n");
  const second = await stash("other.txt", "second\n");
  const result = await gitStashApply(repo, [first, second]);
  expect(result.ok, result.error).toBe(true);
  expect(result.output!.indexOf(first)).toBeLessThan(result.output!.indexOf(second));
  expect(await read("file.txt")).toBe("first\n");
  expect(await read("other.txt")).toBe("second\n");
  expect(await hashes()).toEqual([second, first]);
});

it("blocks dirty indexes, worktrees, untracked files, conflicts and active operations before apply", async () => {
  const hash = await stash("file.txt", "saved\n");
  await put("other.txt", "dirty\n");
  expect((await gitStashApply(repo, [hash])).ok).toBe(false);
  git("add", "other.txt");
  expect((await gitStashApply(repo, [hash])).ok).toBe(false);
  git("restore", "--staged", "--worktree", "other.txt");
  await put("untracked.txt", "keep\n");
  expect((await gitStashApply(repo, [hash])).ok).toBe(false);
  await rm(join(repo, "untracked.txt"));
  await mkdir(join(repo, ".git", "sequencer"));
  expect((await gitStashApply(repo, [hash])).ok).toBe(false);
  expect((await gitStashCreate(repo, ["file.txt"])).ok).toBe(false);
  await rm(join(repo, ".git", "sequencer"), { recursive: true });

  expect(await read("file.txt")).toBe("base\n");
});

it("stops on first batch conflict, reports partial progress, retains conflict state and remaining stashes", async () => {
  const first = await stash("first.txt", "first\n");
  const conflict = await stash("file.txt", "conflicting\n");
  const last = await stash("other.txt", "must not apply\n");
  await put("file.txt", "changed HEAD\n"); git("commit", "-qam", "change HEAD");
  const result = await gitStashApply(repo, [first, conflict, last]);
  expect(result.ok).toBe(false);
  expect(result.output).toContain(`Applied ${first}`);
  expect(result.error).toContain("1/3 applied");
  expect(result.error).toMatch(/conflict/i);
  expect(await read("file.txt")).toContain("<<<<<<<");
  expect(await read("first.txt")).toBe("first\n");
  expect(await read("other.txt")).toBe("other base\n");
  expect(git("ls-files", "--unmerged")).not.toBe("");
  expect((await gitStashCreate(repo, ["file.txt"])).ok).toBe(false);
  expect((await gitStashApply(repo, [last])).ok).toBe(false);
  expect(await hashes()).toEqual([last, conflict, first]);
});

it("drops hashes in arbitrary selected order despite ref renumbering", async () => {
  const oldest = await stash("file.txt", "oldest\n");
  const middle = await stash("file.txt", "middle\n");
  const newest = await stash("file.txt", "newest\n");
  const result = await gitStashDrop(repo, [newest, oldest]);
  expect(result.ok, result.error).toBe(true);
  expect(await hashes()).toEqual([middle]);
  expect((await gitStashList(repo)).entries[0].ref).toBe("stash@{0}");
  expect((await gitStashDrop(repo, [middle])).ok).toBe(true);
  expect(await hashes()).toEqual([]);
});

it("reports honest partial drop results when a later Git command fails", async () => {
  const older = await stash("file.txt", "older\n");
  const newer = await stash("file.txt", "newer\n");
  const realRun = runner.runGit;
  let drops = 0;
  vi.spyOn(runner, "runGit").mockImplementation((dir, args, timeout) => {
    if (args[0] === "stash" && args[1] === "drop" && ++drops === 2) return Promise.resolve({ code: 1, stdout: "", stderr: "simulated ref lock failure" });
    return realRun(dir, args, timeout);
  });
  const result = await gitStashDrop(repo, [newer, older]);
  expect(result.ok).toBe(false);
  expect(result.output).toBe(`Dropped ${newer}`);
  expect(result.error).toContain("1/2 dropped");
  expect(result.error).toContain("simulated ref lock failure");
  expect(await hashes()).toEqual([older]);
});

it("serializes mutations and supports a linked worktree and repository subdirectory", async () => {
  await put("file.txt", "one\n");
  const pending = gitStashCreate(repo, ["file.txt"]);
  const blocked = await gitStashCreate(repo, ["other.txt"]);
  expect(blocked.ok).toBe(false);
  expect(blocked.error).toMatch(/in progress/);
  expect((await pending).ok).toBe(true);
  const linked = join(repo, "linked");
  git("worktree", "add", "-qb", "linked", linked);
  await mkdir(join(linked, "nested"));
  await writeFile(join(linked, "file.txt"), "linked content\n");
  const result = await gitStashCreate(join(linked, "nested"), ["file.txt"]);
  expect(result.ok, result.error).toBe(true);
  expect(await readFile(join(linked, "file.txt"), "utf8")).toBe("base\n");
  const hash = (await hashes())[0];
  expect(git("show", `${hash}:file.txt`)).toBe("linked content\n");
});
