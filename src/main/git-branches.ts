import { lstat } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { runGit, gitNetworkAuthArgs, type GitActionResult } from "./git";
import type { GitBranchAction, GitBranchListResult } from "../shared/git-branches";

function displayRemoteUrl(value: string): string {
  // Never return embedded credentials/query tokens to the renderer.
  if (!value.includes("://")) return value.split(/[?#]/)[0];
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") url.username = "";
    url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return "[Invalid remote URL]"; }
}

export async function gitBranches(dir: string): Promise<GitBranchListResult> {
  const fail = (error: string): GitBranchListResult => ({ ok: false, branches: [], current: null, error });
  if (typeof dir !== "string" || !dir) return fail("Invalid repository");
  const result = await runGit(dir, ["for-each-ref", "--sort=refname", "--format=%(refname)%00%(HEAD)%00%(worktreepath)%00%(upstream)", "refs/heads/"], 10_000);
  if (result.code !== 0) return fail(result.stderr || "Branches unavailable");
  const branches = result.stdout.trimEnd().split("\n").filter(Boolean).map((line) => {
    const [name, head, worktree, upstream] = line.replace(/\r$/, "").split("\0");
    return { name: name.slice("refs/heads/".length), current: head === "*", checkedOut: !!worktree, upstream: upstream?.replace(/^refs\/remotes\//, "") || null };
  });
  const names = await runGit(dir, ["remote"], 10_000);
  if (names.code !== 0) return fail("Remote configuration unavailable");
  const remotes: NonNullable<GitBranchListResult["remotes"]> = [];
  for (const name of names.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const fetch = await runGit(dir, ["remote", "get-url", "--all", "--", name], 10_000);
    const push = await runGit(dir, ["remote", "get-url", "--push", "--all", "--", name], 10_000);
    if (fetch.code !== 0 || push.code !== 0) return fail("Remote URLs unavailable");
    const urls = (text: string): string[] => text.trim().split(/\r?\n/).filter(Boolean).map(displayRemoteUrl);
    // Bind publish confirmation to raw destinations without exposing credentials.
    remotes.push({ name, fetchUrls: urls(fetch.stdout), pushUrls: urls(push.stdout), pushFingerprint: createHash("sha256").update(push.stdout.trim()).digest("hex") });
  }
  const tracking = await runGit(dir, ["for-each-ref", "--sort=refname", "--format=%(refname)%00%(symref)", "refs/remotes/"], 10_000);
  if (tracking.code !== 0) return fail("Remote branches unavailable");
  const remoteNames = remotes.map((remote) => remote.name).sort((a, b) => b.length - a.length);
  const remoteBranches: NonNullable<GitBranchListResult["remoteBranches"]> = [];
  for (const line of tracking.stdout.trimEnd().split("\n").filter(Boolean)) {
    const [ref, symbolic] = line.replace(/\r$/, "").split("\0");
    if (symbolic) continue;
    const remote = remoteNames.find((name) => ref.startsWith(`refs/remotes/${name}/`));
    if (remote) remoteBranches.push({ remote, name: ref.slice(`refs/remotes/${remote}/`.length) });
  }
  return { ok: true, branches, current: branches.find((branch) => branch.current)?.name ?? null, remotes, remoteBranches };
}

export async function gitRemoteAdd(dir: string, name: string, url: string): Promise<GitActionResult> {
  if (changing) return { ok: false, error: "Remote operation already in progress" };
  if (typeof dir !== "string" || !dir) return { ok: false, error: "Invalid repository" };
  if (typeof name !== "string" || typeof url !== "string") return { ok: false, error: "Invalid remote name or URL" };
  const cleanName = name.trim();
  const cleanUrl = url.trim();
  // Control bytes must not reach Git configuration names.
  // eslint-disable-next-line no-control-regex
  if (!cleanName || /[\s\x00-\x1f\x7f]/.test(cleanName) || cleanName.startsWith("-")) {
    return { ok: false, error: "Invalid remote name" };
  }
  if (!cleanUrl || /\s/.test(cleanUrl) || cleanUrl.startsWith("-")) {
    return { ok: false, error: "Invalid remote URL" };
  }
  changing = true;
  try {
    const root = await runGit(dir, ["rev-parse", "--show-toplevel"], 10_000);
    if (root.code !== 0) return { ok: false, error: "Not a working repository" };
    dir = root.stdout.trim();

    const existingRemotes = await runGit(dir, ["remote"], 10_000);
    if (existingRemotes.code === 0) {
      const names = existingRemotes.stdout.trim().split(/\r?\n/).filter(Boolean);
      if (names.includes(cleanName)) {
        return { ok: false, error: `Remote "${cleanName}" already exists` };
      }
    }

    const result = await runGit(dir, ["remote", "add", cleanName, cleanUrl], 15_000);
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return result.code === 0 ? { ok: true, output: text || `Remote "${cleanName}" added` } : { ok: false, error: text || "Failed to add remote" };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    changing = false;
  }
}

// A single lock prevents overlapping branch mutations from separate renderer clicks.
let changing = false;

/** Rename only the local remote alias; Git also updates tracking configuration. */
export async function gitRemoteRename(dir: string, oldName: string, newName: string): Promise<GitActionResult> {
  if (changing) return { ok: false, error: "Remote operation already in progress" };
  if (typeof dir !== "string" || !dir || typeof oldName !== "string" || typeof newName !== "string" ||
      !oldName || !newName || newName !== newName.trim() || newName.length > 256 || /\s/.test(newName) || [...newName].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || newName.startsWith("-")) {
    return { ok: false, error: "Invalid repository or remote name" };
  }
  changing = true;
  try {
    const list = await gitBranches(dir);
    if (!list.ok) return { ok: false, error: list.error };
    if (!list.remotes?.some((remote) => remote.name === oldName)) return { ok: false, error: "Remote no longer exists. Refresh before retrying." };
    if (list.remotes.some((remote) => remote.name === newName)) return { ok: false, error: "Remote name already exists" };
    const valid = await runGit(dir, ["check-ref-format", `refs/remotes/${newName}/probe`], 10_000);
    if (valid.code !== 0) return { ok: false, error: "Invalid remote name" };
    const result = await runGit(dir, ["remote", "rename", "--", oldName, newName], 15_000);
    if (result.code !== 0) return { ok: false, error: result.stderr || "Remote rename failed" };
    const updated = await gitBranches(dir);
    return updated.ok && updated.remotes?.some((remote) => remote.name === newName) && !updated.remotes.some((remote) => remote.name === oldName)
      ? { ok: true, output: `Remote "${oldName}" renamed to "${newName}". No network operation.` }
      : { ok: false, error: "Remote rename could not be verified. Refresh repository state." };
  } catch (err) { return { ok: false, error: String(err) }; }
  finally { changing = false; }
}

/** Tracking configuration is local; publishing is a separate, explicitly confirmed action. */
export async function gitBranchUpstream(dir: string, action: "set" | "unset" | "publish", branch: string, remote: string, target: string, expectedPushFingerprint?: string): Promise<GitActionResult> {
  if (changing) return { ok: false, error: "Branch operation already in progress" };
  if (typeof dir !== "string" || !dir || !["set", "unset", "publish"].includes(action) ||
      typeof branch !== "string" || !branch || branch.startsWith("-") || branch.length > 1024 ||
      typeof remote !== "string" || typeof target !== "string" ||
      (action !== "unset" && (!remote || !target || remote.startsWith("-") || target.startsWith("-") || target.length > 1024))) {
    return { ok: false, error: "Invalid upstream request" };
  }
  changing = true;
  try {
    const list = await gitBranches(dir);
    if (!list.ok) return { ok: false, error: list.error };
    // Bind the operation to the branch shown by the confirmation, never a new HEAD.
    if (list.current !== branch) return { ok: false, error: "Current branch changed. Refresh before retrying." };
    if ((await runGit(dir, ["check-ref-format", `refs/heads/${branch}`], 10_000)).code !== 0) return { ok: false, error: "Invalid branch name" };
    if (action !== "unset") {
      if (!list.remotes?.some((item) => item.name === remote)) return { ok: false, error: "Remote no longer exists. Refresh before retrying." };
      if ((await runGit(dir, ["check-ref-format", `refs/heads/${target}`], 10_000)).code !== 0) return { ok: false, error: "Invalid upstream branch name" };
      if (action === "set" && !list.remoteBranches?.some((item) => item.remote === remote && item.name === target)) {
        return { ok: false, error: "Remote-tracking branch not found. Fetch first, or use Publish and set upstream." };
      }
    }
    const auth = action === "publish" ? await gitNetworkAuthArgs(dir, remote) : [];
    if (action === "publish") {
      const destinations = await runGit(dir, ["remote", "get-url", "--push", "--all", "--", remote], 10_000);
      if (typeof expectedPushFingerprint !== "string" || destinations.code !== 0 ||
          createHash("sha256").update(destinations.stdout.trim()).digest("hex") !== expectedPushFingerprint) {
        return { ok: false, error: "Remote push destinations changed. Refresh and confirm again." };
      }
    }
    const args = action === "unset" ? ["branch", "--unset-upstream", "--", branch]
      : action === "set" ? ["branch", `--set-upstream-to=refs/remotes/${remote}/${target}`, "--", branch]
      // Explicit refspec avoids push.default, configured extra refspecs and tags.
      : [...auth, "push", "--no-force", "--no-mirror", "--no-follow-tags", "--recurse-submodules=no", "--set-upstream", "--", remote, `refs/heads/${branch}:refs/heads/${target}`];
    const result = await runGit(dir, args, action === "publish" ? 300_000 : 15_000);
    if (result.code !== 0) return { ok: false, error: [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || "Upstream operation failed" };
    const updated = await gitBranches(dir);
    const upstream = updated.branches.find((item) => item.name === branch)?.upstream;
    const configuredRemote = await runGit(dir, ["config", "--get", `branch.${branch}.remote`], 10_000);
    const configuredMerge = await runGit(dir, ["config", "--get", `branch.${branch}.merge`], 10_000);
    if (!updated.ok || (action === "unset" ? !!upstream || configuredRemote.code !== 1 || configuredMerge.code !== 1
      : upstream !== `${remote}/${target}` || configuredRemote.stdout.trim() !== remote || configuredMerge.stdout.trim() !== `refs/heads/${target}`)) {
      return { ok: false, error: "Tracking configuration could not be verified. Refresh repository state." };
    }
    return { ok: true, output: action === "unset" ? `Upstream removed from "${branch}". No push.` : `"${branch}" now tracks "${remote}/${target}".${action === "publish" ? " Branch pushed." : " No push."}` };
  } catch (err) { return { ok: false, error: String(err) }; }
  finally { changing = false; }
}

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
