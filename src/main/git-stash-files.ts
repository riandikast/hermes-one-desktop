import { lstat, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runGit, type GitActionResult } from "./git";
import { gitStashList, mutate } from "./git-stash";
import type { GitStashFile, GitStashFilesResult, GitStashFileSelection } from "../shared/git-stash";

const fullHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
type Entry = { mode: string; oid: string };
type Snapshot = { hash: string; parents: string[]; base: Map<string, Entry>; work: Map<string, Entry>; index: Map<string, Entry>; untracked: Map<string, Entry>; files: GitStashFile[] };

async function git(dir: string, args: string[]): Promise<string> {
  const result = await runGit(dir, args, 60_000);
  if (result.code !== 0) throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n").trim() || "Git stash file operation failed");
  return result.stdout;
}
async function root(dir: string): Promise<string> {
  if (typeof dir !== "string" || !dir || dir.includes("\0")) throw new Error("Invalid repository");
  return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
}
function validPath(path: string): void {
  if (typeof path !== "string" || !path || path.length > 4096 || /[\\:]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /[. ]$/.test(part))) throw new Error("Invalid repository-relative file path");
}
async function safePath(dir: string, path: string): Promise<void> {
  validPath(path);
  let current = dir;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error("Select regular files without symlink ancestors");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      break;
    }
  }
}
async function tree(dir: string, ref: string): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  for (const record of (await git(dir, ["ls-tree", "-rz", ref])).split("\0").filter(Boolean)) {
    const match = /^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    if (!match || (match[2] === "commit" && match[1] !== "160000")) throw new Error("Invalid stash tree entry");
    entries.set(match[4], { mode: match[1], oid: match[3] });
  }
  return entries;
}
const equal = (a: Entry | undefined, b: Entry | undefined): boolean => a?.mode === b?.mode && a?.oid === b?.oid;
async function snapshot(dir: string, hash: string): Promise<Snapshot> {
  if (typeof hash !== "string" || !fullHash.test(hash)) throw new Error("Select a valid full stash ID");
  const list = await gitStashList(dir);
  if (!list.ok) throw new Error(list.error);
  if (!list.entries.some((entry) => entry.hash === hash)) throw new Error("Selected stash no longer exists. Refresh before retrying.");
  const parents = (await git(dir, ["show", "-s", "--format=%P", hash])).trim().split(" ");
  if (parents.length < 2 || parents.length > 3 || parents.some((parent) => !fullHash.test(parent))) throw new Error("Unsupported stash structure");
  const base = await tree(dir, parents[0]);
  const work = await tree(dir, hash);
  const index = await tree(dir, parents[1]);
  const untracked = parents[2] ? await tree(dir, parents[2]) : new Map<string, Entry>();
  const files: GitStashFile[] = [];
  for (const path of new Set([...base.keys(), ...work.keys(), ...index.keys(), ...untracked.keys()])) {
    if (equal(base.get(path), work.get(path)) && equal(base.get(path), index.get(path)) && !untracked.has(path)) continue;
    const effective = equal(base.get(path), work.get(path)) ? index : work;
    files.push({ path, status: untracked.has(path) ? "?" : !effective.has(path) ? "D" : !base.has(path) ? "A" : "M" });
  }
  return { hash, parents, base, work, index, untracked, files };
}
async function selections(dir: string, input: GitStashFileSelection[]): Promise<{ saved: Snapshot; paths: string[] }[]> {
  if (!Array.isArray(input) || !input.length || input.length > 500) throw new Error("Select stash files");
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item.hash !== "string" || !fullHash.test(item.hash) || !Array.isArray(item.paths) || !item.paths.length || item.paths.length > 200 || item.paths.join("").length > 16000) throw new Error("Invalid stash file selection");
    for (const path of item.paths) {
      validPath(path);
      const key = `${item.hash}\0${path}`;
      if (seen.has(key)) throw new Error("Duplicate saved file selected");
      seen.add(key);
    }
  }
  const result: { saved: Snapshot; paths: string[] }[] = [];
  for (const item of input) {
    const saved = await snapshot(dir, item.hash);
    for (const path of item.paths) {
      if (!saved.files.some((file) => file.path === path)) throw new Error(`File no longer belongs to selected stash: ${path}. Refresh before retrying.`);
      await safePath(dir, path);
      for (const entries of [saved.base, saved.work, saved.index, saved.untracked]) {
        const entry = entries.get(path);
        if (entry && !/^100(?:644|755)$/.test(entry.mode)) throw new Error("Only regular saved files are supported");
      }
    }
    result.push({ saved, paths: [...item.paths] });
  }
  return result;
}
async function idle(dir: string): Promise<void> {
  const gitDir = (await git(dir, ["rev-parse", "--absolute-git-dir"])).trim();
  for (const marker of ["MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    try { await lstat(join(gitDir, marker)); throw new Error("Finish or cancel the active Git operation first"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  }
  if (await git(dir, ["ls-files", "--unmerged", "-z"])) throw new Error("Resolve existing conflicts first");
}

export async function gitStashFiles(dir: string, hash: string): Promise<GitStashFilesResult> {
  try { dir = await root(dir); return { ok: true, files: (await snapshot(dir, hash)).files }; }
  catch (err) { return { ok: false, files: [], error: String(err) }; }
}
async function filePatch(dir: string, saved: Snapshot, path: string): Promise<string> {
  const options = ["--no-ext-diff", "--no-textconv", "--no-renames", "--binary", "--full-index"];
  return saved.untracked.has(path)
    ? git(dir, ["--literal-pathspecs", "-c", "color.ui=false", "show", "--format=", "--root", ...options, saved.parents[2], "--", path])
    : git(dir, ["--literal-pathspecs", "-c", "color.ui=false", "diff", ...options, saved.parents[0], equal(saved.base.get(path), saved.work.get(path)) ? saved.parents[1] : saved.hash, "--", path]);
}
export async function gitStashFileDiff(dir: string, hash: string, path: string): Promise<GitActionResult> {
  try {
    dir = await root(dir);
    const [{ saved }] = await selections(dir, [{ hash, paths: [path] }]);
    return { ok: true, output: await filePatch(dir, saved, path) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

export function gitStashRestoreFiles(dir: string, input: GitStashFileSelection[]): Promise<GitActionResult> {
  return mutate(async () => {
    dir = await root(dir);
    const selected = await selections(dir, input);
    await idle(dir);
    // ponytail: require an initially clean index/worktree; add merging only with conflict-safe rollback.
    if (await git(dir, ["status", "--porcelain=v1", "--untracked-files=all", "-z"])) throw new Error("Commit or stash local changes, including untracked files, before restoring stash files");
    const completed: string[] = [];
    for (const { saved, paths } of selected) {
      try {
        await snapshot(dir, saved.hash);
        const head = await tree(dir, "HEAD");
        for (const path of paths) {
          await safePath(dir, path);
          if (!equal(head.get(path), saved.base.get(path))) throw new Error(`Current HEAD differs from stash base: ${path}`);
          if (await git(dir, ["--literal-pathspecs", "status", "--porcelain=v1", "--untracked-files=all", "-z", "--", path])) throw new Error(`Local changes would be overwritten: ${path}`);
          if (!head.has(path)) {
            try { await lstat(join(dir, path)); throw new Error(`Existing untracked or ignored file would be overwritten: ${path}`); }
            catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
          }
        }
        for (const path of paths) {
          const patch = await filePatch(dir, saved, path);
          if (patch) {
            const temporary = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "hermes-stash-file-patch-"));
            try {
              const patchFile = join(temporary, "change.patch");
              await writeFile(patchFile, patch);
              await git(dir, ["apply", "--check", "--whitespace=nowarn", "--", patchFile]);
              await git(dir, ["apply", "--whitespace=nowarn", "--", patchFile]);
              await git(dir, ["apply", "--reverse", "--check", "--whitespace=nowarn", "--", patchFile]);
            } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }); }
          }
          completed.push(`Restored ${saved.hash}: ${path}`);
        }
      } catch (err) {
        return { ok: false, output: completed.join("\n"), error: `Stopped at ${saved.hash}; ${completed.length} files restored. Stashes retained. ${String(err)}` };
      }
    }
    return { ok: true, output: completed.join("\n") };
  });
}

async function dropHash(dir: string, hash: string): Promise<void> {
  const list = await gitStashList(dir);
  if (!list.ok) throw new Error(list.error);
  const matches = list.entries.filter((entry) => entry.hash === hash);
  if (matches.length !== 1) throw new Error("Stash disappeared or has duplicate reflog entries; refresh before retrying");
  const entry = matches[0];
  if ((await git(dir, ["rev-parse", "--verify", entry.ref])).trim() !== hash) throw new Error("Stash ref changed; refresh before retrying");
  // Like native stash drop, external Git clients can race the final reflog lookup.
  await git(dir, ["stash", "drop", entry.ref]);
  const after = await gitStashList(dir);
  if (!after.ok || after.entries.some((item) => item.hash === hash)) throw new Error("Stash deletion could not be verified; refresh before retrying");
}
async function remainder(dir: string, saved: Snapshot, paths: string[]): Promise<string> {
  const temporary = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "hermes-stash-files-index-"));
  try {
    const gitDir = (await git(dir, ["rev-parse", "--absolute-git-dir"])).trim();
    await writeFile(join(temporary, "commondir"), (await git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim() + "\n");
    await writeFile(join(temporary, "HEAD"), await readFile(join(gitDir, "HEAD")));
    const prefix = [`--git-dir=${temporary}`, `--work-tree=${dir}`];
    const rewriteTree = async (ref: string, baseline: boolean): Promise<string> => {
      await git(dir, [...prefix, "read-tree", ref]);
      for (const path of paths) {
        if (baseline && saved.base.has(path)) await git(dir, [...prefix, "--literal-pathspecs", "restore", "--staged", `--source=${saved.parents[0]}`, "--", path]);
        else await git(dir, [...prefix, "update-index", "--force-remove", "--", path]);
      }
      return (await git(dir, [...prefix, "write-tree"])).trim();
    };
    const commit = async (original: string, treeHash: string, parents: string[]): Promise<string> => {
      if (treeHash === (await git(dir, ["rev-parse", `${original}^{tree}`])).trim() && parents.join(" ") === (await git(dir, ["show", "-s", "--format=%P", original])).trim()) return original;
      const name = (await git(dir, ["show", "-s", "--format=%an", original])).trim();
      const email = (await git(dir, ["show", "-s", "--format=%ae", original])).trim();
      const message = await git(dir, ["show", "-s", "--format=%B", original]);
      return (await git(dir, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit-tree", treeHash, ...parents.flatMap((parent) => ["-p", parent]), "-m", message])).trim();
    };
    const index = await commit(saved.parents[1], await rewriteTree(saved.parents[1], true), [saved.parents[0]]);
    const parents = [saved.parents[0], index];
    if (saved.parents[2]) parents.push(await commit(saved.parents[2], await rewriteTree(saved.parents[2], false), []));
    return await commit(saved.hash, await rewriteTree(saved.hash, true), parents);
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }); }
}
export function gitStashDeleteFiles(dir: string, input: GitStashFileSelection[]): Promise<GitActionResult> {
  return mutate(async () => {
    dir = await root(dir);
    const validated = await selections(dir, input);
    const grouped = new Map<string, { saved: Snapshot; paths: string[] }>();
    for (const item of validated) {
      const previous = grouped.get(item.saved.hash);
      if (previous) previous.paths.push(...item.paths);
      else grouped.set(item.saved.hash, { saved: item.saved, paths: [...item.paths] });
    }
    const selected = [...grouped.values()];
    const completed: string[] = [];
    for (const { saved, paths } of selected) {
      let replacement: string | undefined;
      try {
        await snapshot(dir, saved.hash);
        if (paths.length < saved.files.length) {
          replacement = await remainder(dir, saved, paths);
          if (replacement === saved.hash) throw new Error("Replacement did not remove selected files; original retained");
          await git(dir, ["stash", "store", "-m", (await git(dir, ["show", "-s", "--format=%s", saved.hash])).trim(), replacement]);
          const check = await snapshot(dir, replacement);
          if (check.parents[0] !== saved.parents[0] || check.parents.length !== saved.parents.length) throw new Error("Replacement parent verification failed; original retained");
          for (const [before, after, baseline] of [[saved.work, check.work, true], [saved.index, check.index, true], [saved.untracked, check.untracked, false]] as const) {
            const expected = new Map(before);
            for (const path of paths) {
              const base = baseline ? saved.base.get(path) : undefined;
              if (base) expected.set(path, base); else expected.delete(path);
            }
            if (expected.size !== after.size || [...expected].some(([path, entry]) => !equal(entry, after.get(path)))) throw new Error("Replacement payload verification failed; original retained");
          }
          if (paths.some((path) => check.files.some((file) => file.path === path))) throw new Error("Replacement verification failed; original retained");
        }
        await dropHash(dir, saved.hash);
        completed.push(`Deleted ${paths.length} saved files from ${saved.hash}${replacement ? `; remainder ${replacement}` : "; stash removed"}. Refresh stash list.`);
      } catch (err) {
        return { ok: false, output: completed.join("\n"), error: `Stopped at ${saved.hash}; ${completed.length}/${selected.length} selections completed.${replacement ? ` Replacement ${replacement} may be saved; refresh before retrying.` : ""} ${String(err)}` };
      }
    }
    return { ok: true, output: completed.join("\n") };
  });
}
