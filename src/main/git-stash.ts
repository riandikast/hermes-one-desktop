import { lstat, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runGit, type GitActionResult } from "./git";
import type { GitStashListResult } from "../shared/git-stash";

const fullHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

async function git(dir: string, args: string[]): Promise<string> {
  const result = await runGit(dir, args, 60_000);
  if (result.code !== 0) throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n").trim() || "Git stash operation failed");
  return result.stdout;
}

async function root(dir: string): Promise<string> {
  if (typeof dir !== "string" || !dir || dir.includes("\0")) throw new Error("Invalid repository");
  return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
}

export async function gitStashList(dir: string): Promise<GitStashListResult> {
  try {
    dir = await root(dir);
    const fields = (await git(dir, ["stash", "list", "-z", "--format=%H%x00%gd%x00%gs"])).split("\0");
    fields.pop();
    if (fields.length % 3) throw new Error("Invalid stash list output");
    const entries: GitStashListResult["entries"] = [];
    for (let i = 0; i < fields.length; i += 3) {
      const [hash, ref, subject] = fields.slice(i, i + 3);
      if (!fullHash.test(hash) || !/^stash@\{\d+\}$/.test(ref)) throw new Error("Invalid stash entry");
      entries.push({ hash, ref, subject });
    }
    return { ok: true, entries };
  } catch (err) { return { ok: false, entries: [], error: String(err) }; }
}

async function selectedHashes(dir: string, hashes: string[]): Promise<string[]> {
  if (!Array.isArray(hashes) || !hashes.length || hashes.length > 500 || hashes.some((hash) => typeof hash !== "string" || !fullHash.test(hash))) throw new Error("Select valid full stash IDs");
  if (new Set(hashes).size !== hashes.length) throw new Error("Duplicate stash IDs selected");
  const list = await gitStashList(dir);
  if (!list.ok) throw new Error(list.error);
  if (hashes.some((hash) => !list.entries.some((entry) => entry.hash === hash))) throw new Error("Selected stash no longer exists. Refresh before retrying.");
  return hashes;
}

async function idle(dir: string): Promise<void> {
  const gitDir = (await git(dir, ["rev-parse", "--absolute-git-dir"])).trim();
  for (const marker of ["MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    try {
      await lstat(join(gitDir, marker));
      throw new Error("Finish or cancel the active Git operation first");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (await git(dir, ["ls-files", "--unmerged", "-z"])) throw new Error("Resolve existing conflicts first");
}

// Serialize stash mutations across renderer requests, including repository aliases.
let changing = false;
export async function mutate(action: () => Promise<GitActionResult>): Promise<GitActionResult> {
  if (changing) return { ok: false, error: "Stash operation already in progress" };
  changing = true;
  try { return await action(); }
  catch (err) { return { ok: false, error: String(err) }; }
  finally { changing = false; }
}

export function gitStashCreate(dir: string, paths: string[]): Promise<GitActionResult> {
  return mutate(async () => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 200) throw new Error("Select 1–200 repository-relative files");
    if (paths.some((path) => typeof path !== "string" || !path || path.length > 4096 || /[\\:]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) || paths.join("").length > 16000) throw new Error("Invalid repository-relative file path");
    paths = [...new Set(paths)];
    dir = await root(dir);
    await idle(dir);
    for (const path of paths) {
      let current = dir;
      const parts = path.split("/");
      for (let i = 0; i < parts.length; i++) {
        current = join(current, parts[i]);
        try {
          const stat = await lstat(current);
          if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error("Select regular files without symlink ancestors");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          break; // Tracked deletions have no worktree file.
        }
      }
    }
    const files = new Set((await git(dir, ["--literal-pathspecs", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...paths])).split("\0"));
    const headFiles = (await git(dir, ["--literal-pathspecs", "ls-tree", "--name-only", "-r", "-z", "HEAD", "--", ...paths])).split("\0").filter(Boolean);
    for (const path of headFiles) files.add(path);
    if (paths.some((path) => !files.has(path))) throw new Error("Select tracked or non-ignored untracked files, not directories");
    const tracked = (await git(dir, ["--literal-pathspecs", "ls-files", "--cached", "-z", "--", ...paths])).split("\0").filter(Boolean);
    // Git stash -u can save then fail cleanup for an already-staged deletion.
    // Refuse before mutation rather than risk a half-cleaned staged rename.
    if (headFiles.some((path) => !tracked.includes(path))) throw new Error("Staged deletions (including rename source paths) cannot be stashed here. Unstage those deletions first, then select both rename paths if applicable.");
    const before = await gitStashList(dir);
    if (!before.ok) throw new Error(before.error);
    const gitDir = (await git(dir, ["rev-parse", "--absolute-git-dir"])).trim();
    const commonDir = (await git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    const indexTree = (await git(dir, ["write-tree"])).trim();
    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
    const temporary = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "hermes-stash-index-"));
    try {
      // Native path-limited stash still snapshots ALL staged files. Use a private
      // index with unselected entries reset to HEAD; never unstage user files.
      await writeFile(join(temporary, "commondir"), commonDir + "\n");
      await writeFile(join(temporary, "HEAD"), await readFile(join(gitDir, "HEAD")));
      const prefix = [`--git-dir=${temporary}`, `--work-tree=${dir}`];
      await git(dir, [...prefix, "read-tree", indexTree]);
      await git(dir, [...prefix, "reset", "-q", "HEAD", "--", ".", ...paths.map((path) => `:(top,exclude,literal)${path}`)]);
      let output: string;
      try {
        output = await git(dir, [...prefix, "--literal-pathspecs", "stash", "push", "--include-untracked", "-m", "Selected files", "--", ...paths]);
      } catch (err) {
        const after = await gitStashList(dir);
        const saved = after.ok && after.entries[0]?.hash !== before.entries[0]?.hash ? after.entries[0]?.hash : null;
        throw new Error(`${saved ? `Stash saved as ${saved}, but cleanup failed. ` : "Stash command failed; inspect working tree before retrying. "}${String(err)}`);
      }
      const after = await gitStashList(dir);
      if (!after.ok) throw new Error(after.error);
      if (after.entries[0]?.hash === before.entries[0]?.hash) return { ok: true, output: output.trim() || "No selected changes to stash" };
      try {
        if (tracked.length) await git(dir, ["--literal-pathspecs", "restore", "--staged", "--source=HEAD", "--", ...tracked]);
        if ((await git(dir, ["rev-parse", "HEAD"])).trim() !== head || await git(dir, ["--literal-pathspecs", "status", "--porcelain=v1", "--untracked-files=all", "-z", "--", ...paths])) throw new Error("HEAD changed or selected files still have changes; refresh repository status");
      } catch (err) {
        return { ok: false, output: output.trim(), error: `Stash saved as ${after.entries[0].hash}, but selected index cleanup failed: ${String(err)}` };
      }
      return { ok: true, output: output.trim() };
    } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }); }
  });
}

export function gitStashApply(dir: string, hashes: string[]): Promise<GitActionResult> {
  return mutate(async () => {
    dir = await root(dir);
    hashes = await selectedHashes(dir, hashes);
    await idle(dir);
    if (await git(dir, ["status", "--porcelain=v1", "--untracked-files=all", "-z"])) throw new Error("Commit or stash local changes, including untracked files, before applying stashes");
    const completed: string[] = [];
    for (const hash of hashes) {
      try {
        // Do not pop: conflicts and successful applies both retain the stash.
        await selectedHashes(dir, [hash]);
        const output = await git(dir, ["stash", "apply", hash]);
        if (await git(dir, ["ls-files", "--unmerged", "-z"])) throw new Error("Stash apply left unresolved conflicts");
        await selectedHashes(dir, [hash]);
        completed.push(`Applied ${hash}\n${output.trim()}`);
      } catch (err) {
        return { ok: false, output: completed.join("\n"), error: `Stopped at ${hash}; ${completed.length}/${hashes.length} applied. Stashes retained. ${String(err)}` };
      }
    }
    return { ok: true, output: completed.join("\n") };
  });
}

export function gitStashDrop(dir: string, hashes: string[]): Promise<GitActionResult> {
  return mutate(async () => {
    dir = await root(dir);
    hashes = await selectedHashes(dir, hashes);
    const completed: string[] = [];
    for (const hash of hashes) {
      try {
        const list = await gitStashList(dir);
        if (!list.ok) throw new Error(list.error);
        const entry = list.entries.find((entry) => entry.hash === hash);
        if (!entry) throw new Error("Stash disappeared; refresh before retrying");
        // External Git clients can still race this lookup; the lock is in-process.
        await git(dir, ["stash", "drop", entry.ref]);
        const after = await gitStashList(dir);
        if (!after.ok || after.entries.some((item) => item.hash === hash)) throw new Error("Stash drop could not be verified");
        completed.push(`Dropped ${hash}`);
      } catch (err) {
        return { ok: false, output: completed.join("\n"), error: `Stopped at ${hash}; ${completed.length}/${hashes.length} dropped. ${String(err)}` };
      }
    }
    return { ok: true, output: completed.join("\n") };
  });
}

export async function gitStashDiff(dir: string, hash: string): Promise<GitActionResult> {
  try {
    dir = await root(dir);
    await selectedHashes(dir, [hash]);
    return { ok: true, output: await git(dir, ["-c", "color.ui=false", "stash", "show", "--patch", "--include-untracked", "--no-ext-diff", "--no-textconv", hash]) };
  } catch (err) { return { ok: false, error: String(err) }; }
}
