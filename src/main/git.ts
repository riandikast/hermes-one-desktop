import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { relative, join } from "path";
import { extractHostFromRemoteUrl, gitTokenAuthArgs } from "./git-credentials";

/**
 * Minimal git integration for the Source Control dialog. Runs the `git` CLI
 * in the repo directory (no shell — args are passed directly, so messages
 * and paths are injection-safe), with `GIT_TERMINAL_PROMPT=0` so credential
 * prompts never hang the UI. All operations are bounded by a timeout.
 */

export interface GitFileEntry {
  index: string;
  worktree: string;
  path: string;
}

export interface GitStatusResult {
  repo: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  conflicted: GitFileEntry[];
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  error?: string;
}

export interface GitActionResult {
  ok: boolean;
  output?: string;
  error?: string;
}

/**
 * Optional per-host token lookup for network ops (set up by the IPC layer
 * from the encrypted token store). When a token exists for the remote's
 * host, push/pull/fetch attach it as `Authorization: Bearer`.
 */
type TokenProvider = (host: string) => string | null;
let tokenProvider: TokenProvider | null = null;
export function setGitTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(
  dir: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        LC_ALL: "C.UTF-8",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Parse `git status --porcelain=v1 -z` output (records split by NUL;
 *  rename entries emit the original path then the new path as two records). */
function parsePorcelainV1Z(output: string): GitFileEntry[] {
  const records = output.split("\0");
  const files: GitFileEntry[] = [];
  let pending: GitFileEntry | null = null;
  for (const rec of records) {
    if (!rec) continue;
    const m = rec.match(/^(..) (.*)$/s);
    if (m) {
      pending = { index: m[1][0], worktree: m[1][1], path: m[2] };
      files.push(pending);
    } else if (pending) {
      // Rename target record (git emits `R  orig\0new`).
      pending.path = rec;
    }
  }
  return files;
}

function isConflicted(entry: GitFileEntry): boolean {
  const pair = entry.index + entry.worktree;
  return (
    entry.index === "U" ||
    entry.worktree === "U" ||
    /^(DD|AA|AU|UA|DU|UD)$/.test(pair)
  );
}

function parseBranchHeader(record: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  // `## main...origin/main [ahead 1, behind 2]` / `## HEAD (no branch)`.
  const body = record.replace(/^## /, "");
  const rest = body.split(" [")[0] ?? "";
  const bracket = body.match(/\[([^\]]*)\]/)?.[1] ?? "";
  const aheadMatch = bracket.match(/ahead (\d+)/);
  const behindMatch = bracket.match(/behind (\d+)/);
  if (body.startsWith("HEAD")) {
    return { branch: null, upstream: null, ahead: 0, behind: 0 };
  }
  const [branch, upstream] = rest.split("...");
  return {
    branch: branch || null,
    upstream: upstream || null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

export async function gitRepoStatus(dir: string): Promise<GitStatusResult> {
  const inside = await runGit(dir, [
    "-c",
    "core.quotepath=false",
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return {
      repo: false,
      root: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      conflicted: [],
      staged: [],
      unstaged: [],
      untracked: [],
    };
  }

  const root = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  const status = await runGit(dir, [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "-b",
    "-z",
  ]);

  const result: GitStatusResult = {
    repo: true,
    root: root.code === 0 ? root.stdout.trim() || null : null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    conflicted: [],
    staged: [],
    unstaged: [],
    untracked: [],
  };
  if (status.code !== 0) {
    result.error = status.stderr.trim() || "git status failed";
    return result;
  }

  const records = status.stdout.split("\0").filter(Boolean);
  if (records.length > 0 && records[0].startsWith("## ")) {
    Object.assign(result, parseBranchHeader(records[0]));
    // The branch header is a record in the same stream — drop it before
    // parsing file entries, or it parses as a bogus `##` file.
    records.shift();
  }
  const files = parsePorcelainV1Z(records.join("\0"));
  for (const entry of files) {
    if (isConflicted(entry)) {
      result.conflicted.push(entry);
    } else if (entry.index === "?" && entry.worktree === "?") {
      result.untracked.push(entry.path);
    } else {
      if (entry.index !== " ") result.staged.push(entry);
      if (entry.worktree !== " ") result.unstaged.push(entry);
    }
  }
  return result;
}

export async function gitDiff(
  dir: string,
  path: string,
  staged: boolean,
): Promise<GitActionResult> {
  const args = [
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    ...(staged ? ["--cached"] : []),
    "--",
    path,
  ];
  const res = await runGit(dir, args);
  return res.code === 0
    ? { ok: true, output: res.stdout }
    : { ok: false, error: res.stderr.trim() || "git diff failed" };
}

async function runGitAction(
  dir: string,
  args: string[],
  timeoutMs: number,
): Promise<GitActionResult> {
  const res = await runGit(dir, args, timeoutMs);
  if (res.code === 0) {
    const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
    return { ok: true, output: output || "ok" };
  }
  return {
    ok: false,
    error:
      [res.stderr, res.stdout].filter(Boolean).join("\n").trim() ||
      `git ${args[0]} failed`,
  };
}

/** Resolve the remote host of the repo's first push remote (https or ssh). */
export async function gitRemoteHost(dir: string): Promise<string | null> {
  const res = await runGit(dir, ["remote", "-v"]);
  for (const line of res.stdout.split("\n")) {
    if (!line.includes("(push)")) continue;
    const url = line.split(/\s+/)[1];
    const host = extractHostFromRemoteUrl(url ?? "");
    if (host) return host;
  }
  return null;
}

/** One file the working tree changed during a turn, with before/after content
 *  for the file-changes summary (before from the HEAD blob when tracked). */
export interface GitWorkingTreeChange {
  path: string;
  before: string | null;
  after: string | null;
  /** Porcelain status pair, e.g. "M", "A", "D", "??", "MM". */
  status: string;
}

/**
 * Compute the working-tree changes via git — the authoritative detection for
 * the per-turn file-changes summary: it catches EVERY change (including
 * terminal/write-tool writes the tool-event capture missed) and provides the
 * before-content from the HEAD blob. Returns [] when `dir` is not inside a
 * git work tree (callers fall back to tool-event capture) or git fails.
 * Only changes under `dir` are returned (the repo root may be an ancestor).
 */
export async function getGitWorkingTreeChanges(
  dir: string,
  opts: { maxFiles?: number } = {},
): Promise<GitWorkingTreeChange[]> {
  const maxFiles = opts.maxFiles ?? 50;
  const inside = await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return [];

  const rootResult = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  const repoRoot = rootResult.code === 0 ? rootResult.stdout.trim() : "";
  if (!repoRoot) return [];

  const status = await runGit(dir, [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "-z",
  ]);
  if (status.code !== 0) return [];

  const relPrefix = relative(repoRoot, dir).replace(/\\/g, "/");
  const entries = parsePorcelainV1Z(status.stdout);
  const out: GitWorkingTreeChange[] = [];

  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    // Restrict to the context folder when the repo root is an ancestor.
    if (
      relPrefix &&
      !(entry.path === relPrefix || entry.path.startsWith(`${relPrefix}/`))
    ) {
      continue;
    }
    if (entry.path.endsWith("/")) continue; // untracked directory placeholder
    const pair = (entry.index + entry.worktree).trim();
    const isUntracked = pair === "??";
    const isDeleted = pair.includes("D");
    const abs = join(repoRoot, entry.path);

    let before: string | null = null;
    let after: string | null = null;
    if (!isUntracked) {
      // Size guard: skip loading huge blobs into the summary.
      const sizeRes = await runGit(dir, [
        "cat-file",
        "-s",
        `HEAD:${entry.path}`,
      ]);
      const blobBytes = Number(sizeRes.stdout.trim());
      if (!Number.isFinite(blobBytes) || blobBytes <= 2 * 1024 * 1024) {
        const show = await runGit(dir, ["show", `HEAD:${entry.path}`]);
        if (show.code === 0) before = show.stdout;
      }
    }
    if (!isDeleted) {
      try {
        const st = await import("fs/promises").then((m) => m.stat(abs));
        if (st.isFile() && st.size <= 2 * 1024 * 1024) {
          after = await readFile(abs, "utf8");
        }
      } catch {
        after = null;
      }
    }
    out.push({ path: abs, before, after, status: pair });
  }

  return out;
}

/** One commit row for the Source Control graph. */
export interface GitCommitEntry {
  /** Full 40-char object name. */
  hash: string;
  /** Abbreviated hash, as git renders it (7+ chars). */
  shortHash: string;
  /** Parent object names; 0 = root commit, 2+ = a merge. */
  parents: string[];
  /** Local branch names pointing at this commit (decorations), if any. */
  refs: string[];
  author: string;
  /** Author date, ISO-8601, for relative rendering. */
  date: string;
  subject: string;
}

/** Field separator that cannot appear in a commit subject (unit separator). */
const LOG_FIELD_SEP = "\u001f";
/** Record separator (record separator) — survives subjects containing newlines. */
const LOG_RECORD_SEP = "\u001e";

/**
 * Read the commit history for the Source Control graph.
 *
 * Read-only and bounded: `--max-count` caps the walk so a huge repo cannot
 * stall the dialog, and the format is machine-parsed (US/RS separators) rather
 * than the decorated log, so a subject containing any punctuation is safe.
 * `--topo-order` keeps parents after children, which is what a lane-based
 * graph renderer needs to lay out rows without backtracking.
 */
export async function gitLog(
  dir: string,
  opts: { max?: number; path?: string } = {},
): Promise<{ ok: boolean; commits: GitCommitEntry[]; error?: string }> {
  const max = Math.min(Math.max(opts.max ?? 50, 1), 200);
  const args = [
    "-c",
    "core.quotepath=false",
    "log",
    "--topo-order",
    "--date=iso-strict",
    `--max-count=${max}`,
    // %H hash, %h short, %P parents, %D ref names, %an author, %aI date, %s subject
    `--pretty=format:%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%P${LOG_FIELD_SEP}%D${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%s${LOG_RECORD_SEP}`,
  ];
  // An optional pathspec scopes the history to the selected file/folder.
  if (opts.path) args.push("--", opts.path);

  const res = await runGit(dir, args);
  if (res.code !== 0) {
    // An empty repo (no commits yet) exits non-zero with this message; that is
    // an empty history, not an error worth surfacing as a failure.
    const stderr = res.stderr.trim();
    if (/does not have any commits yet|unknown revision/i.test(stderr)) {
      return { ok: true, commits: [] };
    }
    return { ok: false, commits: [], error: stderr || "git log failed" };
  }

  const commits: GitCommitEntry[] = [];
  for (const record of res.stdout.split(LOG_RECORD_SEP)) {
    const line = record.replace(/^\n+/, "");
    if (!line.trim()) continue;
    const [hash, shortHash, parentList, refNames, author, date, ...rest] =
      line.split(LOG_FIELD_SEP);
    if (!hash) continue;
    commits.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      parents: (parentList ?? "").trim() ? parentList.trim().split(/\s+/) : [],
      // Decorations look like `HEAD -> main, origin/main, tag: v1.0`; keep the
      // local branch names (drop HEAD/tags/remotes) for compact chips.
      refs: (refNames ?? "")
        .split(",")
        .map((r) => r.trim().replace(/^HEAD -> /, ""))
        .filter((r) => r && !r.startsWith("tag:") && !r.includes("/")),
      author: author ?? "",
      date: date ?? "",
      subject: (rest.join(LOG_FIELD_SEP) || "").trim(),
    });
  }
  return { ok: true, commits };
}

/** Diff introduced by a single commit (`git show`), for the graph pane. */
export async function gitCommitDiff(
  dir: string,
  hash: string,
): Promise<GitActionResult> {
  // A hash is attacker-influenceable only via our own git log output, but
  // validate anyway so a malformed value can never become an option/refspec.
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
    return { ok: false, error: "invalid commit hash" };
  }
  const res = await runGit(dir, [
    "-c",
    "core.quotepath=false",
    "show",
    "--no-color",
    "--format=%H%n%an <%ae>%n%aI%n%s%n",
    hash,
  ]);
  return res.code === 0
    ? { ok: true, output: res.stdout }
    : { ok: false, error: res.stderr.trim() || "git show failed" };
}

/** Auth args for the repo's remote host when a token is stored for it. */
async function gitNetworkAuthArgs(dir: string): Promise<string[]> {
  if (!tokenProvider) return [];
  const host = await gitRemoteHost(dir);
  if (!host) return [];
  return gitTokenAuthArgs(host, tokenProvider(host));
}

export function gitStage(
  dir: string,
  paths: string[],
): Promise<GitActionResult> {
  return runGitAction(dir, ["add", "--", ...paths], 60_000);
}

export function gitUnstage(
  dir: string,
  paths: string[],
): Promise<GitActionResult> {
  return runGitAction(dir, ["restore", "--staged", "--", ...paths], 60_000);
}

export function gitCommit(
  dir: string,
  message: string,
): Promise<GitActionResult> {
  return runGitAction(dir, ["commit", "-m", message], 60_000);
}

// Network operations get a long timeout (5 min): with Git Credential Manager
// installed, `git push`/`pull`/`fetch` pop GCM's own login window (it ignores
// GIT_TERMINAL_PROMPT=0, which only suppresses git's built-in console prompt),
// and a human may take a while to sign in. The spawned process runs to
// completion even if the dialog closes meanwhile. A stored PAT for the
// remote's host is attached as a bearer token, which also covers new
// machines with no cached credentials.
export async function gitPull(dir: string): Promise<GitActionResult> {
  return runGitAction(
    dir,
    [...(await gitNetworkAuthArgs(dir)), "pull", "--no-edit"],
    300_000,
  );
}

export async function gitPush(dir: string): Promise<GitActionResult> {
  return runGitAction(
    dir,
    [...(await gitNetworkAuthArgs(dir)), "push"],
    300_000,
  );
}

export async function gitFetch(dir: string): Promise<GitActionResult> {
  return runGitAction(
    dir,
    [...(await gitNetworkAuthArgs(dir)), "fetch"],
    300_000,
  );
}

export async function gitResolveConflict(
  dir: string,
  path: string,
  side: "ours" | "theirs",
): Promise<GitActionResult> {
  // `checkout --ours/--theirs` fixes the worktree but leaves the index
  // unmerged — `git add` marks the conflict resolved (moves it to staged).
  const checkout = await runGitAction(
    dir,
    ["checkout", `--${side}`, "--", path],
    60_000,
  );
  if (!checkout.ok) return checkout;
  return gitStage(dir, [path]);
}
