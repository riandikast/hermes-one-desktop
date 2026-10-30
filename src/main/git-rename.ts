import { lstat } from "fs/promises";
import { join } from "path";
import { runGit, type GitActionResult } from "./git";

/** Rename only local HEAD; never rebase descendants or rewrite published history. */
export async function gitRenameCheck(dir: string, hash: string): Promise<GitActionResult> {
  if (typeof dir !== "string" || !dir || typeof hash !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash)) return { ok: false, error: "Invalid repository or full commit ID" };
  const head = await runGit(dir, ["rev-parse", "--verify", "HEAD"], 10_000);
  const branch = await runGit(dir, ["symbolic-ref", "-q", "HEAD"], 10_000);
  if (head.code !== 0 || head.stdout.trim() !== hash || branch.code !== 0) return { ok: false, error: "Only the latest commit on the current local branch can be renamed" };
  const status = await runGit(dir, ["status", "--porcelain=v1", "-z"], 10_000);
  if (status.code !== 0 || status.stdout) return { ok: false, error: "Commit or stash local changes before renaming a commit" };
  const gitDir = await runGit(dir, ["rev-parse", "--absolute-git-dir"], 10_000);
  if (gitDir.code !== 0) return { ok: false, error: "Repository state unavailable" };
  for (const marker of ["MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    try { await lstat(join(gitDir.stdout.trim(), marker)); return { ok: false, error: "Finish or cancel the active Git operation first" }; }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, error: String(err) }; }
  }
  const tracked = await runGit(dir, ["for-each-ref", `--contains=${hash}`, "--format=%(refname)", "refs/remotes/"], 10_000);
  if (tracked.code !== 0 || tracked.stdout.trim()) return { ok: false, error: "Commit is reachable from a remote-tracking branch; renaming refused" };
  const remotes = await runGit(dir, ["remote"], 10_000);
  if (remotes.code !== 0) return { ok: false, error: "Could not verify remotes" };
  // Tracking refs may be stale. Check advertised remote heads/tags without pushing or fetching.
  for (const remote of remotes.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const refs = await runGit(dir, ["ls-remote", "--heads", "--tags", "--", remote], 30_000);
    if (refs.code !== 0) return { ok: false, error: `Could not verify remote ${remote}. Renaming refused.` };
    for (const tip of new Set(refs.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[0]))) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(tip)) return { ok: false, error: "Invalid remote commit ID" };
      const contains = await runGit(dir, ["merge-base", "--is-ancestor", hash, tip], 10_000);
      if (contains.code === 0) return { ok: false, error: "Commit is already published on a remote branch or tag; renaming refused" };
      if (contains.code !== 1) return { ok: false, error: "Remote history is not available locally. Fetch before renaming." };
    }
  }
  const message = await runGit(dir, ["show", "-s", "--format=%B", hash], 10_000);
  return message.code === 0 ? { ok: true, output: message.stdout.replace(/\n$/, "") } : { ok: false, error: "Commit message unavailable" };
}

let renaming = false;
export async function gitRenameCommit(dir: string, hash: string, message: string): Promise<GitActionResult> {
  if (renaming) return { ok: false, error: "Commit rename already in progress" };
  if (typeof message !== "string" || !message.trim() || message.length > 16384 || message.includes("\0")) return { ok: false, error: "Invalid commit message" };
  renaming = true;
  try {
    const checked = await gitRenameCheck(dir, hash);
    if (!checked.ok) return checked;
    const head = await runGit(dir, ["rev-parse", "HEAD"], 10_000);
    if (head.code !== 0 || head.stdout.trim() !== hash) return { ok: false, error: "HEAD changed. Refresh history first." };
    // --only prevents unrelated staged paths being included if another writer stages during validation.
    const result = await runGit(dir, ["-c", "core.editor=true", "commit", "--amend", "--only", "-m", message], 60_000);
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return result.code === 0 ? { ok: true, output: text } : { ok: false, error: text || "Commit rename failed" };
  } finally { renaming = false; }
}
