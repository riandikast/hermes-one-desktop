// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gitBranches, gitBranchChange, gitBranchUpstream, gitRemoteAdd, gitRemoteSetUrl } from "./git-branches";
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

it("lists configured fetch/push URLs without network calls or leaking embedded credentials", async () => {
  expect((await gitBranches(repo)).remotes).toEqual([]);
  git("remote", "add", "origin", "https://fixture-user:fixture-password@example.invalid/org/repo.git?token=fixture-token#secret");
  git("remote", "set-url", "--push", "origin", "git@example.invalid:org/push.git");
  const result = await gitBranches(repo);
  expect(result.ok, result.error).toBe(true);
  expect(result.remotes).toEqual([expect.objectContaining({ name: "origin", fetchUrls: ["https://example.invalid/org/repo.git"], pushUrls: ["git@example.invalid:org/push.git"] })]);
  expect(JSON.stringify(result)).not.toMatch(/fixture-user|fixture-password|fixture-token|secret/);
});

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

it("adds new remotes with validation and rejects existing names or invalid arguments", async () => {
  expect((await gitRemoteAdd(repo, "origin", "https://example.invalid/org/repo.git")).ok).toBe(true);
  const remotes = (await gitBranches(repo)).remotes;
  expect(remotes?.find((r) => r.name === "origin")?.fetchUrls).toEqual(["https://example.invalid/org/repo.git"]);

  // Duplicate name rejection
  const dup = await gitRemoteAdd(repo, "origin", "https://example.invalid/org/other.git");
  expect(dup.ok).toBe(false);
  expect(dup.error).toContain("already exists");

  // Invalid names / URLs
  expect((await gitRemoteAdd(repo, "-bad", "https://example.invalid")).ok).toBe(false);
  expect((await gitRemoteAdd(repo, "upstream", "bad url with spaces")).ok).toBe(false);
  expect((await gitRemoteAdd(repo, "", "https://example.invalid")).ok).toBe(false);
});

it("changes an existing remote URL in place, keeps tracking, and verifies by read-back", async () => {
  const bare = join(repo, "second-remote.git");
  git("init", "--bare", "-q", bare);
  expect((await gitRemoteAdd(repo, "upstream", "https://example.invalid/old.git")).ok).toBe(true);
  git("update-ref", "refs/remotes/upstream/main", "HEAD");
  git("config", "branch.main.remote", "upstream");
  git("config", "branch.main.merge", "refs/heads/main");

  const changed = await gitRemoteSetUrl(repo, "upstream", "https://example.invalid/new.git");
  expect(changed.ok, changed.error).toBe(true);
  const remote = (await gitBranches(repo)).remotes?.find((item) => item.name === "upstream");
  expect(remote?.fetchUrls).toEqual(["https://example.invalid/new.git"]);
  // Same remote name and tracking survive: no remove/re-add.
  expect(git("config", "branch.main.remote").trim()).toBe("upstream");
  expect(git("rev-parse", "refs/remotes/upstream/main").trim()).toBe(git("rev-parse", "HEAD").trim());

  // A distinct push URL is set only when asked for.
  const pushed = await gitRemoteSetUrl(repo, "upstream", "https://example.invalid/new.git", bare);
  expect(pushed.ok, pushed.error).toBe(true);
  const withPush = (await gitBranches(repo)).remotes?.find((item) => item.name === "upstream");
  expect(withPush?.pushUrls).toEqual([bare]);

  // No-op and unknown remote fail with a readable reason instead of a silent success.
  expect((await gitRemoteSetUrl(repo, "upstream", "https://example.invalid/new.git", bare)).ok).toBe(false);
  expect((await gitRemoteSetUrl(repo, "missing", "https://example.invalid/x.git")).error).toContain("no longer exists");
  for (const bad of ["", "has spaces", "-dash", "x".repeat(2050)]) {
    expect((await gitRemoteSetUrl(repo, "upstream", bad)).ok).toBe(false);
  }
  expect(git("remote", "get-url", "upstream").trim()).toBe("https://example.invalid/new.git");
}, 30_000);

it("sets upstream for a branch that was never fetched, fetching only that ref and never pushing", async () => {
  const bare = join(repo, "origin.git");
  git("init", "--bare", "-q", bare);
  git("remote", "add", "origin", bare);
  // Publish the current tip, then commit locally so a push would be visible.
  git("push", "-q", "origin", "main:main");
  const published = git("rev-parse", "HEAD").trim();
  await writeFile(join(repo, "local-only.txt"), "local\n");
  git("add", "."); git("commit", "-qm", "local only");
  git("update-ref", "-d", "refs/remotes/origin/main");
  expect(git("for-each-ref", "refs/remotes/origin")).toBe("");

  const result = await gitBranchUpstream(repo, "set", "main", "origin", "main");
  expect(result.ok, result.error).toBe(true);
  expect(result.output).toContain("Branch fetched; no push.");
  expect(git("config", "branch.main.remote").trim()).toBe("origin");
  expect(git("config", "branch.main.merge").trim()).toBe("refs/heads/main");
  expect(git("for-each-ref", "refs/remotes/origin/main")).not.toBe("");
  // The remote branch is untouched: the local-only commit was not uploaded.
  expect(git("rev-parse", "refs/remotes/origin/main").trim()).toBe(published);
  expect(git("rev-parse", "HEAD").trim()).not.toBe(published);
}, 30_000);
