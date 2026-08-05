import { spawn } from "child_process";
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
