// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gitBranches, gitBranchChange } from "./git-branches";
import type { GitBranchAction } from "../shared/git-branches";

let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
beforeEach(async () => {
  repo = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "branches-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  git("config", "core.autocrlf", "false");
  await writeFile(join(repo, "file.txt"), "base\n");
  git("add", "."); git("commit", "-qm", "base");
});
afterEach(async () => { await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

it("lists, creates, switches, merges into current, and safely deletes local branches", async () => {
  expect((await gitBranches(repo)).current).toBe("main");
  expect((await gitBranchChange(repo, "create", "feature/example", "main")).ok).toBe(true);
  expect((await gitBranches(repo)).current).toBe("main");
  expect((await gitBranchChange(repo, "checkout", "feature/example", "main")).ok).toBe(true);
  await writeFile(join(repo, "feature.txt"), "feature\n"); git("add", "."); git("commit", "-qm", "feature");
  expect((await gitBranchChange(repo, "checkout", "main", "feature/example")).ok).toBe(true);
  expect((await gitBranchChange(repo, "delete", "feature/example", "main")).ok).toBe(false);
  expect((await gitBranchChange(repo, "merge", "feature/example", "main")).ok).toBe(true);
  expect(await readFile(join(repo, "feature.txt"), "utf8")).toBe("feature\n");
  expect((await gitBranchChange(repo, "delete", "feature/example", "main")).ok).toBe(true);
  expect((await gitBranches(repo)).branches.map((branch) => branch.name)).toEqual(["main"]);
}, 30_000);

it("rejects invalid input, stale current branch, current deletion, dirty and untracked worktrees", async () => {
  git("branch", "other");
  for (const name of ["--force", "HEAD; echo bad", "../escape", "a\nb", "a..b"]) {
    expect((await gitBranchChange(repo, "create", name, "main")).ok).toBe(false);
  }
  expect((await gitBranchChange(repo, "reset" as GitBranchAction, "other", "main")).ok).toBe(false);
  expect((await gitBranchChange(repo, "checkout", "other", "stale")).ok).toBe(false);
  expect((await gitBranchChange(repo, "delete", "main", "main")).ok).toBe(false);
  await writeFile(join(repo, "file.txt"), "unsaved\n");
  for (const action of ["checkout", "merge"] as const) expect((await gitBranchChange(repo, action, "other", "main")).ok).toBe(false);
  expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("unsaved\n");
  git("restore", "file.txt");
  await writeFile(join(repo, "untracked.txt"), "keep");
  expect((await gitBranchChange(repo, "checkout", "other", "main")).ok).toBe(false);
});

it("refuses branches checked out elsewhere and protects ignored files during checkout", async () => {
  git("branch", "other");
  const worktree = join(repo, "linked");
  git("worktree", "add", "-q", worktree, "other");
  expect((await gitBranches(repo)).branches.find((branch) => branch.name === "other")?.checkedOut).toBe(true);
  expect((await gitBranchChange(repo, "delete", "other", "main")).ok).toBe(false);
  git("worktree", "remove", worktree);
  git("switch", "-q", "other");
  await writeFile(join(repo, "ignored.txt"), "tracked elsewhere"); git("add", "."); git("commit", "-qm", "other file");
  git("switch", "-q", "main");
  await writeFile(join(repo, ".git", "info", "exclude"), "ignored.txt\n");
  await writeFile(join(repo, "ignored.txt"), "precious ignored content");
  expect((await gitBranchChange(repo, "checkout", "other", "main")).ok).toBe(false);
  expect(await readFile(join(repo, "ignored.txt"), "utf8")).toBe("precious ignored content");
  expect((await gitBranchChange(repo, "merge", "other", "main")).ok).toBe(false);
  expect(await readFile(join(repo, "ignored.txt"), "utf8")).toBe("precious ignored content");
});

it("reports merge conflicts, preserving current branch and blocks further mutations", async () => {
  git("switch", "-qc", "other");
  await writeFile(join(repo, "file.txt"), "other\n"); git("commit", "-qam", "other edit");
  git("switch", "-q", "main");
  await writeFile(join(repo, "file.txt"), "main\n"); git("commit", "-qam", "main edit");
  const result = await gitBranchChange(repo, "merge", "other", "main");
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/conflict/i);
  expect((await gitBranches(repo)).current).toBe("main");
  expect((await gitBranchChange(repo, "create", "blocked", "main")).ok).toBe(false);
  git("merge", "--abort");
  expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("main\n");
});

it("lists an unborn repository and refuses branch creation without HEAD", async () => {
  const empty = join(repo, "empty");
  await mkdir(empty);
  execFileSync("git", ["init", "-q", "-b", "main", empty]);
  expect((await gitBranches(empty)).branches).toEqual([]);
  expect((await gitBranchChange(empty, "create", "new", null)).ok).toBe(false);
});

it("handles detached HEAD and blocks unfinished sequencers", async () => {
  git("checkout", "-q", "--detach");
  expect((await gitBranches(repo)).current).toBeNull();
  expect((await gitBranchChange(repo, "create", "from-detached", null)).ok).toBe(true);
  await mkdir(join(repo, ".git", "sequencer"));
  expect((await gitBranchChange(repo, "checkout", "main", null)).ok).toBe(false);
});
