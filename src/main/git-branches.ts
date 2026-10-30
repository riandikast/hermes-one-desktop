import { lstat } from "fs/promises";
import { join } from "path";
import { runGit, type GitActionResult } from "./git";
import type { GitBranchAction, GitBranchListResult } from "../shared/git-branches";

export async function gitBranches(dir: string): Promise<GitBranchListResult> {
  const fail = (error: string): GitBranchListResult => ({ ok: false, branches: [], current: null, error });
  if (typeof dir !== "string" || !dir) return fail("Invalid repository");
  const result = await runGit(dir, ["for-each-ref", "--sort=refname", "--format=%(refname)%00%(HEAD)%00%(worktreepath)", "refs/heads/"], 10_000);
  if (result.code !== 0) return fail(result.stderr || "Branches unavailable");
  const branches = result.stdout.trimEnd().split("\n").filter(Boolean).map((line) => {
    const [name, head, worktree] = line.replace(/\r$/, "").split("\0");
    return { name: name.slice("refs/heads/".length), current: head === "*", checkedOut: !!worktree };
  });
  return { ok: true, branches, current: branches.find((branch) => branch.current)?.name ?? null };
}

// A single lock prevents overlapping branch mutations from separate renderer clicks.
let changing = false;
export async function gitBranchChange(dir: string, action: GitBranchAction, name: string, expectedCurrent: string | null): Promise<GitActionResult> {
  if (changing) return { ok: false, error: "Branch operation already in progress" };
  if (typeof dir !== "string" || !dir) return { ok: false, error: "Invalid repository" };
  if (!["checkout", "merge", "create", "delete"].includes(action) || typeof name !== "string" || !name || name.length > 1024 || name.startsWith("-") || /\s/.test(name)) return { ok: false, error: "Invalid branch action or name" };
  changing = true;
  try {
    const valid = await runGit(dir, ["check-ref-format", `refs/heads/${name}`], 10_000);
    if (valid.code !== 0) return { ok: false, error: "Invalid branch name" };
    const root = await runGit(dir, ["rev-parse", "--show-toplevel"], 10_000);
    if (root.code !== 0) return { ok: false, error: "Not a working repository" };
    dir = root.stdout.trim();
    const list = await gitBranches(dir);
    if (!list.ok) return { ok: false, error: list.error };
    if (list.current !== expectedCurrent) return { ok: false, error: "Current branch changed. Refresh before retrying." };
    const target = list.branches.find((branch) => branch.name === name);
    if (action === "create" ? !!target : !target) return { ok: false, error: action === "create" ? "Branch already exists" : "Local branch not found" };
    if ((action === "delete" || action === "checkout") && target?.checkedOut) return { ok: false, error: "Branch is already checked out in a worktree" };
    if (action === "merge" && (!list.current || target?.current)) return { ok: false, error: "Select another branch to merge into the current branch" };
    // Never interfere with a Git operation owned by another command or UI.
    const gitDir = await runGit(dir, ["rev-parse", "--absolute-git-dir"], 10_000);
    if (gitDir.code !== 0) return { ok: false, error: "Could not check repository operation state" };
    for (const marker of ["MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
      try {
        await lstat(join(gitDir.stdout.trim(), marker));
        return { ok: false, error: "Finish or cancel the active Git operation first" };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    if (action === "checkout" || action === "merge") {
      const status = await runGit(dir, ["status", "--porcelain=v1", "-z"], 10_000);
      if (status.code !== 0 || status.stdout) return { ok: false, error: "Commit or stash local changes, including untracked files, before switching or merging" };
    }
    if (action === "delete") {
      const merged = await runGit(dir, ["merge-base", "--is-ancestor", `refs/heads/${name}`, "HEAD"], 10_000);
      if (merged.code !== 0) return { ok: false, error: "Branch is not fully merged into the current HEAD; deletion refused" };
    }
    const args = action === "checkout" ? ["switch", "--no-guess", "--no-overwrite-ignore", name]
      : action === "merge" ? ["merge", "--no-edit", "--no-overwrite-ignore", `refs/heads/${name}`]
      : action === "create" ? ["branch", "--", name, "HEAD"]
      : ["branch", "-d", "--", name];
    const result = await runGit(dir, args, 60_000);
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return result.code === 0 ? { ok: true, output: text || "Branch updated" } : { ok: false, error: text || "Branch operation failed" };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally { changing = false; }
}
