// @vitest-environment node

import { execFileSync } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitWorkingTreeChanges,
  gitCommit,
  gitCommitDiff,
  gitDiff,
  gitLog,
  gitRepoStatus,
  gitResolveConflict,
  gitStage,
  gitUnstage,
} from "./git";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: dir },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

describe("git source control", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "hermes-git-test-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@test");
    git(repo, "config", "user.name", "Test");
    // Avoid CRLF normalization racing `git add` after `checkout --ours`.
    git(repo, "config", "core.autocrlf", "false");
    await writeFile(join(repo, "a.txt"), "hello\n", "utf8");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "initial");
  });

  afterEach(async () => {
    // Windows git children can hold the cwd briefly after exit — retry the
    // cleanup so a lingering handle doesn't fail the test as EBUSY.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(repo, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  });

  it("reports untracked and unstaged changes with branch info", async () => {
    await writeFile(join(repo, "b.txt"), "new\n", "utf8");
    await writeFile(join(repo, "a.txt"), "hello world\n", "utf8");

    const status = await gitRepoStatus(repo);

    expect(status.repo).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.untracked).toContain("b.txt");
    expect(status.unstaged.map((f) => f.path)).toContain("a.txt");
    expect(status.conflicted).toHaveLength(0);
    expect(status.staged).toHaveLength(0);
  });

  it("moves files between staged and unstaged", async () => {
    await writeFile(join(repo, "a.txt"), "v2\n", "utf8");

    const staged = await gitStage(repo, ["a.txt"]);
    expect(staged.ok).toBe(true);
    let status = await gitRepoStatus(repo);
    expect(status.staged.map((f) => f.path)).toContain("a.txt");
    expect(status.unstaged.some((f) => f.path === "a.txt")).toBe(false);

    const unstaged = await gitUnstage(repo, ["a.txt"]);
    expect(unstaged.ok).toBe(true);
    status = await gitRepoStatus(repo);
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged.map((f) => f.path)).toContain("a.txt");
  });

  it("commits staged changes", async () => {
    await writeFile(join(repo, "a.txt"), "committed\n", "utf8");
    await gitStage(repo, ["a.txt"]);

    const res = await gitCommit(repo, "my commit message");
    expect(res.ok).toBe(true);

    const status = await gitRepoStatus(repo);
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
    const log = git(repo, "log", "-1", "--format=%s");
    expect(log.trim()).toBe("my commit message");
  });

  it("produces a diff for changed files", async () => {
    await writeFile(join(repo, "a.txt"), "hello world\n", "utf8");

    const res = await gitDiff(repo, "a.txt", false);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("-hello");
    expect(res.output).toContain("+hello world");
  });

  it("resolves conflicts by checking out the chosen side", async () => {
    // Simulate a conflicted file: base + two conflicting commits.
    git(repo, "config", "user.email", "test@test");
    git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "a.txt"), "base\n", "utf8");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "checkout", "-q", "-b", "feature");
    await writeFile(join(repo, "a.txt"), "feature change\n", "utf8");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "feature");
    git(repo, "checkout", "-q", "main");
    await writeFile(join(repo, "a.txt"), "main change\n", "utf8");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "main");

    // Merge with conflict (expect non-zero exit).
    try {
      git(repo, "merge", "feature");
    } catch {
      /* expected conflict */
    }

    let status = await gitRepoStatus(repo);
    expect(status.conflicted.map((f) => f.path)).toContain("a.txt");

    const res = await gitResolveConflict(repo, "a.txt", "ours");
    expect(res.ok).toBe(true);

    status = await gitRepoStatus(repo);
    expect(status.conflicted).toHaveLength(0);
  }, 30_000);

  it("reports non-repo directories", async () => {
    const plain = await mkdtemp(join(tmpdir(), "hermes-git-plain-"));
    try {
      const status = await gitRepoStatus(plain);
      expect(status.repo).toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  describe("getGitWorkingTreeChanges", () => {
    it("captures modified, untracked, and deleted files with before/after content", async () => {
      // Modify a.txt (tracked), add b.txt (untracked), delete c.txt (tracked).
      await writeFile(join(repo, "c.txt"), "old c\n", "utf8");
      git(repo, "add", "c.txt");
      git(repo, "commit", "-q", "-m", "add c");

      await writeFile(join(repo, "a.txt"), "hello world\n", "utf8");
      await writeFile(join(repo, "b.txt"), "brand new\n", "utf8");
      await rm(join(repo, "c.txt"));

      const changes = await getGitWorkingTreeChanges(repo);

      const byPath = new Map(changes.map((c) => [c.path, c]));
      // Modified: before = HEAD blob, after = working tree.
      expect(byPath.get(join(repo, "a.txt"))).toMatchObject({
        before: "hello\n",
        after: "hello world\n",
      });
      // Untracked: before null, after = content.
      expect(byPath.get(join(repo, "b.txt"))).toMatchObject({
        before: null,
        after: "brand new\n",
      });
      // Deleted: before = HEAD blob, after null.
      expect(byPath.get(join(repo, "c.txt"))).toMatchObject({
        before: "old c\n",
        after: null,
      });
    });

    it("returns [] for a non-repo directory", async () => {
      const plain = await mkdtemp(join(tmpdir(), "hermes-git-plain-"));
      try {
        await writeFile(join(plain, "x.txt"), "x\n", "utf8");
        expect(await getGitWorkingTreeChanges(plain)).toEqual([]);
      } finally {
        await rm(plain, { recursive: true, force: true });
      }
    });

    it("only returns changes under the given subdirectory", async () => {
      const sub = join(repo, "sub");
      await mkdir(sub, { recursive: true });
      await writeFile(join(repo, "outside.txt"), "o\n", "utf8");
      git(repo, "add", "outside.txt");
      git(repo, "commit", "-q", "-m", "outside");
      await writeFile(join(repo, "outside.txt"), "o2\n", "utf8");
      await writeFile(join(repo, "sub", "inside.txt"), "i\n", "utf8");
      git(repo, "add", "sub");
      git(repo, "commit", "-q", "-m", "sub");
      await writeFile(join(repo, "sub", "inside.txt"), "i2\n", "utf8");

      const changes = await getGitWorkingTreeChanges(sub);
      expect(changes.map((c) => c.path)).toEqual([
        join(repo, "sub", "inside.txt"),
      ]);
    });
  });

  describe("gitLog", () => {
    it("returns commits newest-first with hash, parents, and refs", async () => {
      await writeFile(join(repo, "a.txt"), "second\n", "utf8");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "second commit");

      const res = await gitLog(repo, { max: 10 });
      expect(res.ok).toBe(true);
      expect(res.commits).toHaveLength(2);
      // Newest first, and the tip carries the branch ref.
      expect(res.commits[0].subject).toBe("second commit");
      expect(res.commits[0].refs).toContain("main");
      // The root commit has no parents; the tip has exactly one.
      expect(res.commits[0].parents).toHaveLength(1);
      expect(res.commits[1].parents).toHaveLength(0);
      // The tip's parent is the root commit's hash.
      expect(res.commits[0].parents[0]).toBe(res.commits[1].hash);
      expect(
        res.commits[0].shortHash.startsWith(res.commits[0].hash.slice(0, 7)),
      ).toBe(true);
    });

    it("records both parents for a merge commit", async () => {
      git(repo, "checkout", "-q", "-b", "feature");
      await writeFile(join(repo, "f.txt"), "feature\n", "utf8");
      git(repo, "add", "f.txt");
      git(repo, "commit", "-q", "-m", "feature work");
      git(repo, "checkout", "-q", "main");
      await writeFile(join(repo, "m.txt"), "main\n", "utf8");
      git(repo, "add", "m.txt");
      git(repo, "commit", "-q", "-m", "main work");
      git(repo, "merge", "--no-ff", "-q", "-m", "merge feature", "feature");

      const res = await gitLog(repo, { max: 10 });
      expect(res.ok).toBe(true);
      const merge = res.commits.find((c) => c.subject === "merge feature");
      expect(merge).toBeTruthy();
      expect(merge!.parents).toHaveLength(2);
    }, 30_000);

    it("respects the max bound", async () => {
      for (let i = 0; i < 4; i += 1) {
        await writeFile(join(repo, "a.txt"), `v${i}\n`, "utf8");
        git(repo, "add", "a.txt");
        git(repo, "commit", "-q", "-m", `commit ${i}`);
      }
      const res = await gitLog(repo, { max: 3 });
      expect(res.commits).toHaveLength(3);
    });

    it("returns an empty history (not an error) for a repo with no commits", async () => {
      const fresh = await mkdtemp(join(tmpdir(), "hermes-git-empty-"));
      try {
        git(fresh, "init", "-q", "-b", "main");
        const res = await gitLog(fresh);
        expect(res.ok).toBe(true);
        expect(res.commits).toEqual([]);
      } finally {
        await rm(fresh, { recursive: true, force: true });
      }
    });
  });

  describe("gitCommitDiff", () => {
    it("shows the change a commit introduced", async () => {
      await writeFile(join(repo, "a.txt"), "hello world\n", "utf8");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "change a");
      const hash = git(repo, "rev-parse", "HEAD").trim();

      const res = await gitCommitDiff(repo, hash);
      expect(res.ok).toBe(true);
      expect(res.output).toContain("-hello");
      expect(res.output).toContain("+hello world");
      expect(res.output).toContain("change a");
    });

    it("rejects a malformed hash instead of passing it to git", async () => {
      const res = await gitCommitDiff(repo, "HEAD; rm -rf /");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("invalid commit hash");
    });
  });
});
