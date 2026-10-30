import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { gitDiscard } from "./git";

describe("git discard", () => {
  it("restores only the literal tracked file and protects staged and untracked data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "discard-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    try {
      git("init"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
      for (const name of ["a.txt", "b.txt"]) await writeFile(join(dir, name), "original");
      git("add", "--all"); git("commit", "-m", "initial");
      await writeFile(join(dir, "a.txt"), "changed");
      await writeFile(join(dir, "b.txt"), "staged"); git("add", "b.txt"); await writeFile(join(dir, "b.txt"), "unstaged");
      await writeFile(join(dir, "new.txt"), "untracked");
      expect((await gitDiscard(dir, "../outside")).ok).toBe(false);
      expect((await gitDiscard(dir, "new.txt")).ok).toBe(false);
      expect((await gitDiscard(dir, "b.txt")).ok).toBe(false);
      expect((await gitDiscard(dir, ":(glob)*.txt")).ok).toBe(false);
      expect((await gitDiscard(dir, "a.txt")).ok).toBe(true);
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("original");
      expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("unstaged");
      expect(git("show", ":b.txt").toString()).toBe("staged");
      expect(await readFile(join(dir, "new.txt"), "utf8")).toBe("untracked");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
