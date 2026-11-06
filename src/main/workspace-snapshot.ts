import { createHash } from "crypto";
import { constants } from "fs";
import type { Stats } from "fs";
import { lstat, open, realpath } from "fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "path";
import { TextDecoder } from "util";
import type { WorkspaceSnapshot, WorkspaceSnapshotFile } from "../shared/workspace-snapshot";
import { runGit } from "./git";

const MAX_PATHS = 5_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const GIT_ARGS = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.quotePath=false"];

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

function sensitive(path: string): boolean {
  return path.split(/[\\/]/).some((part) =>
    /^(?:\.git|\.ssh|\.aws|\.azure|\.gnupg|\.docker|\.env(?:\..*)?|\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?|(?:auth|tokens?)\.json|(?:client[._-]?secret|service[._-]?account|private[._-]?key)(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(part),
  );
}

/** Check every ancestor too: a regular leaf may otherwise traverse a symlink/junction. */
async function checkedPath(path: string): Promise<Stats> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  let info = await lstat(current);
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    info = await lstat(current);
    if (info.isSymbolicLink() || relative(current, await realpath(current)) !== "") {
      throw new Error("symlink");
    }
  }
  return info;
}

/**
 * Read-only working-tree coverage. Missing files are deletions; excluded files
 * are UNKNOWN, never deletions. Callers must ignore exclusions from either side.
 * Enumeration/aggregate-cap failures disable the entire comparison (root:null).
 */
let captureQueue: Promise<unknown> = Promise.resolve();

export function captureWorkspaceSnapshot(folder: string): Promise<WorkspaceSnapshot> {
  const capture = captureQueue.then(() => readWorkspaceSnapshot(folder));
  captureQueue = capture.catch(() => undefined);
  return capture;
}

async function readWorkspaceSnapshot(folder: string): Promise<WorkspaceSnapshot> {
  const disabled = (warning: string): WorkspaceSnapshot => ({ root: null, files: [], warning });
  if (typeof folder !== "string" || !isAbsolute(folder) || folder.includes("\0")) {
    return disabled("Workspace snapshot requires an absolute attached directory.");
  }
  try {
    if (!(await checkedPath(folder)).isDirectory()) {
      return disabled("Workspace snapshot requires an existing attached directory.");
    }
    const root = await realpath(folder);
    const repoResult = await runGit(root, [...GIT_ARGS, "rev-parse", "--show-toplevel"], 10_000);
    if (repoResult.code !== 0) {
      if (/not a git repository/i.test(repoResult.stderr)) return { root: null, files: [] };
      return disabled("Workspace snapshot Git discovery failed.");
    }
    const reportedRoot = repoResult.stdout.replace(/\r?\n$/, "");
    if (!isAbsolute(reportedRoot) || !(await checkedPath(reportedRoot)).isDirectory()) {
      return disabled("Workspace snapshot Git root is invalid.");
    }
    const repo = await realpath(reportedRoot);
    if (!inside(repo, root)) return disabled("Workspace snapshot Git root is outside the attached scope.");
    const scope = relative(repo, root).split(sep).join("/") || ".";
    const listed = await runGit(repo, [
      ...GIT_ARGS, "ls-files", "--cached", "--others", "--exclude-standard", "--full-name", "-z", "--", scope,
    ], 10_000);
    if (listed.code !== 0 || (listed.stdout && !listed.stdout.endsWith("\0"))) {
      return disabled("Workspace snapshot Git enumeration failed.");
    }
    const names = [...new Set(listed.stdout.split("\0").filter(Boolean))];
    if (names.length > MAX_PATHS) return disabled("Workspace snapshot exceeded 5000 paths; comparison disabled.");
    const ignored = await runGit(repo, [
      ...GIT_ARGS, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z", "--", scope,
    ], 10_000);
    if (ignored.code !== 0 || (ignored.stdout && !ignored.stdout.endsWith("\0"))) {
      return disabled("Workspace snapshot ignored-path enumeration failed.");
    }
    const files: WorkspaceSnapshotFile[] = [];
    const excludedPaths = ignored.stdout.split("\0").filter(Boolean).map((name) => resolve(repo, name));
    if (excludedPaths.some((path) => !inside(root, path))) return disabled("Workspace snapshot ignored path escaped the attached scope.");
    const counts: Record<string, number> = {};
    let totalBytes = 0;
    const exclude = (path: string, reason: string): void => {
      excludedPaths.push(path);
      counts[reason] = (counts[reason] || 0) + 1;
    };
    for (const name of names) {
      if (isAbsolute(name) || name.split("/").some((part) => !part || part === "." || part === "..") ||
          (process.platform === "win32" && /[\\:]/.test(name)) || name.includes("\uFFFD")) {
        return disabled("Workspace snapshot Git returned an invalid path.");
      }
      const path = resolve(repo, name);
      if (!inside(root, path)) return disabled("Workspace snapshot Git returned an out-of-scope path.");
      if (sensitive(path)) { exclude(path, "sensitive"); continue; }
      try {
        const info = await checkedPath(path);
        if (!info.isFile()) { exclude(path, "symlink/submodule/unsupported"); continue; }
        if (info.size > MAX_FILE_BYTES) { exclude(path, "over 256 KiB"); continue; }
        if (totalBytes + info.size > MAX_TOTAL_BYTES) {
          return disabled("Workspace snapshot exceeded 16 MiB total reads; comparison disabled.");
        }
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size) {
            exclude(path, "changed during capture"); continue;
          }
          await checkedPath(path);
          const bytes = Buffer.alloc(before.size);
          let offset = 0;
          while (offset < bytes.length) {
            const read = await handle.read(bytes, offset, bytes.length - offset, offset);
            totalBytes += read.bytesRead;
            if (!read.bytesRead) break;
            offset += read.bytesRead;
          }
          const after = await handle.stat();
          const leaf = await checkedPath(path);
          if (offset !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
              before.ctimeMs !== after.ctimeMs || leaf.dev !== after.dev || leaf.ino !== after.ino) {
            exclude(path, "changed during capture"); continue;
          }
          let content: string | null = null;
          try {
            const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            if (![...text].some((char) => {
              const code = char.charCodeAt(0);
              return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
            })) content = text; // Printable UTF-8 only.
          } catch { /* Binary/invalid UTF-8 still has an authoritative byte fingerprint. */ }
          files.push({ path, fingerprint: createHash("sha256").update(bytes).digest("hex"), content });
        } finally { await handle.close(); }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        exclude(path, error instanceof Error && error.message === "symlink" ? "symlink" : "unreadable");
      }
    }
    const warning = Object.entries(counts).map(([reason, count]) => `${count} ${reason}`).join(", ");
    return {
      root, files, ...(excludedPaths.length ? { excludedPaths } : {}),
      ...(warning ? { warning: `Workspace snapshot excluded ${warning}.` } : {}),
    };
  } catch {
    return disabled("Workspace snapshot could not safely read the attached directory.");
  }
}
