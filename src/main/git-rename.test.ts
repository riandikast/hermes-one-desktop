// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gitRenameCheck, gitRenameCommit } from "./git-rename";
let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
beforeEach(async () => {
  repo = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "rename-test-"));
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  await writeFile(join(repo, "a.txt"), "one"); git("add", "."); git("commit", "-qm", "original");
});
afterEach(async () => { await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
it("renames unpublished HEAD without changing tree, parents, or working files", async () => {
  const hash = git("rev-parse", "HEAD"); const tree = git("rev-parse", "HEAD^{tree}");
  expect((await gitRenameCheck(repo, hash)).ok).toBe(true);
  const result = await gitRenameCommit(repo, hash, "new subject\n\nkeep body");
  expect(result.ok, result.error).toBe(true);
  expect(git("log", "-1", "--format=%B")).toBe("new subject\n\nkeep body");
  expect(git("rev-parse", "HEAD")).not.toBe(hash);
  expect(git("rev-parse", "HEAD^{tree}")).toBe(tree);
  expect(git("status", "--porcelain")).toBe("");
});
it("refuses non-HEAD, dirty, detached, active operations and invalid inputs", async () => {
  const hash = git("rev-parse", "HEAD");
  expect((await gitRenameCommit(repo, "--bad", "message")).ok).toBe(false);
  expect((await gitRenameCommit(repo, hash, " ")).ok).toBe(false);
  await writeFile(join(repo, "a.txt"), "unsaved"); git("add", ".");
  expect((await gitRenameCommit(repo, hash, "no")).ok).toBe(false);
  git("reset", "--hard", "HEAD"); git("commit", "--allow-empty", "-qm", "second");
  expect((await gitRenameCommit(repo, hash, "no")).ok).toBe(false);
  const current = git("rev-parse", "HEAD"); git("checkout", "-q", "--detach");
  expect((await gitRenameCommit(repo, current, "no")).ok).toBe(false);
  git("switch", "-q", "main"); await mkdir(join(repo, ".git", "sequencer"));
  expect((await gitRenameCommit(repo, current, "no")).ok).toBe(false);
});
it("rejects remote commits even when remote-tracking refs have not been fetched", async () => {
  const remote = join(repo, ".git", "remote.git");
  execFileSync("git", ["init", "--bare", "-q", remote]); git("remote", "add", "origin", remote);
  const hash = git("rev-parse", "HEAD"); git("push", "-q", "origin", "main"); git("update-ref", "-d", "refs/remotes/origin/main");
  const result = await gitRenameCommit(repo, hash, "must not rewrite");
  expect(result.ok).toBe(false); expect(result.error).toMatch(/published/);
  expect(git("rev-parse", "HEAD")).toBe(hash);
}, 15_000);
it("permits new local HEAD after remote ancestor; refuses stale tracking and inaccessible remotes", async () => {
  const remote = join(repo, ".git", "remote.git"); execFileSync("git", ["init", "--bare", "-q", remote]); git("remote", "add", "origin", remote); git("push", "-q", "origin", "main");
  git("commit", "--allow-empty", "-qm", "local only");
  const hash = git("rev-parse", "HEAD");
  expect((await gitRenameCheck(repo, hash)).ok).toBe(true);
  git("update-ref", "refs/remotes/origin/old", hash);
  expect((await gitRenameCheck(repo, hash)).ok).toBe(false);
  git("update-ref", "-d", "refs/remotes/origin/old"); git("remote", "set-url", "origin", join(repo, "missing.git"));
  expect((await gitRenameCheck(repo, hash)).ok).toBe(false);
}, 15_000);
