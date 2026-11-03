// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gitBranches, gitRemoteRename, gitBranchUpstream } from "./git-branches";

let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
beforeEach(async () => {
  repo = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "upstream-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  await writeFile(join(repo, "file.txt"), "base\n");
  git("add", "."); git("commit", "-qm", "base");
});
afterEach(async () => { await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// @lat: [[source-control#Source Control (git)#Remote names and upstream tracking]]
it("renames remote aliases and updates upstreams without modifying URLs or commits", async () => {
  git("remote", "add", "master", "https://example.invalid/repo.git");
  git("update-ref", "refs/remotes/master/main", "HEAD");
  git("symbolic-ref", "refs/remotes/master/HEAD", "refs/remotes/master/main");
  git("branch", "master/main");
  git("branch", "origin/main");
  const before = git("rev-parse", "HEAD");
  expect((await gitBranchUpstream(repo, "set", "main", "master", "main")).ok).toBe(true);
  expect((await gitRemoteRename(repo, "master", "origin")).ok).toBe(true);
  const list = await gitBranches(repo);
  expect(list.branches[0].upstream).toBe("origin/main");
  expect(list.remoteBranches).toEqual([{ remote: "origin", name: "main" }]);
  expect(list.remotes?.[0].fetchUrls).toEqual(["https://example.invalid/repo.git"]);
  expect(git("rev-parse", "HEAD")).toBe(before);
  expect((await gitBranchUpstream(repo, "unset", "main", "", "")).ok).toBe(true);
  expect((await gitBranches(repo)).branches[0].upstream).toBeNull();
}, 30_000);

it("rejects collisions, malformed names, missing refs and stale branch requests", async () => {
  git("remote", "add", "master", "https://example.invalid/repo.git");
  git("remote", "add", "origin", "https://example.invalid/other.git");
  for (const name of ["origin", "-bad", "bad name", "a..b", "../bad", "", "bad\nname"]) {
    expect((await gitRemoteRename(repo, "master", name)).ok).toBe(false);
  }
  expect((await gitRemoteRename(repo, "missing", "new")).ok).toBe(false);
  expect((await gitRemoteRename(repo, "master", null as unknown as string)).ok).toBe(false);
  expect((await gitBranchUpstream(repo, "set", "main", "master", "missing")).ok).toBe(false);
  expect((await gitBranchUpstream(repo, "publish", "stale", "master", "main")).ok).toBe(false);
  expect((await gitBranchUpstream(repo, "publish", "main", "missing", "main")).ok).toBe(false);
  for (const target of ["--all", "main:other", "a..b", "main\nother"]) {
    expect((await gitBranchUpstream(repo, "publish", "main", "master", target)).ok).toBe(false);
  }
  git("checkout", "--detach", "-q");
  expect((await gitBranchUpstream(repo, "set", "main", "master", "main")).ok).toBe(false);
}, 30_000);

it("publishes only one branch to a local bare remote, rejects non-fast-forward updates", async () => {
  const bare = join(repo, "fixture-remote.git");
  git("init", "--bare", "-q", bare);
  git("remote", "add", "master", bare);
  git("branch", "unrelated");
  git("tag", "-a", "do-not-push", "-m", "tag");
  git("config", "push.followTags", "true");
  git("config", "remote.master.push", "refs/heads/unrelated:refs/heads/unrelated");
  const fingerprint = (await gitBranches(repo)).remotes![0].pushFingerprint;
  const result = await gitBranchUpstream(repo, "publish", "main", "master", "feature/published", fingerprint);
  expect(result.ok, result.error).toBe(true);
  expect(git("--git-dir", bare, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/feature/published");
  expect((await gitBranches(repo)).branches[0].upstream).toBe("master/feature/published");
  git("checkout", "--orphan", "unrelated-history");
  git("commit", "--allow-empty", "-qm", "unrelated history");
  const tip = git("--git-dir", bare, "rev-parse", "refs/heads/feature/published");
  const rejected = await gitBranchUpstream(repo, "publish", "unrelated-history", "master", "feature/published", fingerprint);
  expect(rejected.ok).toBe(false);
  expect(git("--git-dir", bare, "rev-parse", "refs/heads/feature/published")).toBe(tip);
}, 30_000);

it("rejects stale push destinations before publishing any commits", async () => {
  const first = join(repo, "first.git");
  const second = join(repo, "second.git");
  git("init", "--bare", "-q", first);
  git("init", "--bare", "-q", second);
  git("remote", "add", "master", first);
  const fingerprint = (await gitBranches(repo)).remotes![0].pushFingerprint;
  git("remote", "set-url", "master", second);
  const result = await gitBranchUpstream(repo, "publish", "main", "master", "main", fingerprint);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("destinations changed");
  expect(git("--git-dir", first, "for-each-ref")).toBe("");
  expect(git("--git-dir", second, "for-each-ref")).toBe("");
  expect((await gitBranchUpstream(repo, "publish", "main", "master", "main")).ok).toBe(false);
  expect((await gitBranches(repo)).branches[0].upstream).toBeNull();
}, 30_000);
