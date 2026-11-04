import {
  cp,
  lstat,
  mkdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import { dirname, isAbsolute, join, relative } from "path";

export type ExplorerResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A single path segment — no separators, traversal, or Windows-invalid names. */
export function validateEntryName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "Name cannot be empty";
  if (name !== name.trim()) return "Name cannot start or end with a space";
  if (name.includes("\u0000")) return "Name contains an invalid character";
  if (/[\\/:*?"<>|]/.test(name)) return "Name contains an invalid character";
  if (
    process.platform === "win32" &&
    (WINDOWS_RESERVED.test(name) || /[. ]$/.test(name))
  )
    return "That name is reserved on Windows";
  return null;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}

async function realTarget(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Resolve the target only when it exists and its REAL path stays inside root. */
async function guardExisting(
  root: string,
  target: string,
): Promise<{ root: string; target: string } | null> {
  if (typeof root !== "string" || typeof target !== "string") return null;
  if (!isAbsolute(root) || !isAbsolute(target)) return null;
  const [realRoot, real] = await Promise.all([
    realTarget(root),
    realTarget(target),
  ]);
  if (!realRoot || !real || !inside(realRoot, real)) return null;
  return { root: realRoot, target: real };
}

/** Parent must exist inside root; the new child name is validated separately. */
async function guardParent(
  root: string,
  parent: string,
): Promise<{ root: string; parent: string } | null> {
  if (typeof root !== "string" || typeof parent !== "string") return null;
  if (!isAbsolute(root) || !isAbsolute(parent)) return null;
  const [realRoot, real] = await Promise.all([
    realTarget(root),
    realTarget(parent),
  ]);
  if (!realRoot || !real || (real !== realRoot && !inside(realRoot, real)))
    return null;
  const info = await stat(real).catch(() => null);
  if (!info?.isDirectory()) return null;
  return { root: realRoot, parent: real };
}

function failure(error: unknown): ExplorerResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

export async function renameExplorerEntry(
  root: string,
  from: string,
  name: string,
): Promise<ExplorerResult> {
  const nameError = validateEntryName(name);
  if (nameError) return { ok: false, error: nameError };
  const guarded = await guardExisting(root, from);
  if (!guarded)
    return { ok: false, error: "Path is outside the opened folder" };
  const to = join(dirname(guarded.target), name);
  if (to === guarded.target) return { ok: true, path: to };
  if (await exists(to))
    return {
      ok: false,
      error: "A file or folder with that name already exists",
    };
  try {
    await rename(guarded.target, to);
    return { ok: true, path: to };
  } catch (error) {
    return failure(error);
  }
}

export async function createExplorerEntry(
  root: string,
  parent: string,
  name: string,
  kind: "file" | "directory",
): Promise<ExplorerResult> {
  const nameError = validateEntryName(name);
  if (nameError) return { ok: false, error: nameError };
  if (kind !== "file" && kind !== "directory")
    return { ok: false, error: "Invalid entry type" };
  const guarded = await guardParent(root, parent);
  if (!guarded)
    return { ok: false, error: "Folder is outside the opened folder" };
  const target = join(guarded.parent, name);
  if (await exists(target))
    return {
      ok: false,
      error: "A file or folder with that name already exists",
    };
  try {
    if (kind === "directory") await mkdir(target);
    else await writeFile(target, "", { encoding: "utf-8", flag: "wx" });
    return { ok: true, path: target };
  } catch (error) {
    return failure(error);
  }
}

/** Trash first (recoverable); injectable so tests never touch a real Recycle Bin. */
export async function deleteExplorerEntry(
  root: string,
  target: string,
  trash: (path: string) => Promise<void>,
): Promise<ExplorerResult> {
  const guarded = await guardExisting(root, target);
  if (!guarded)
    return { ok: false, error: "Path is outside the opened folder" };
  try {
    await trash(guarded.target);
    return { ok: true, path: guarded.target };
  } catch (error) {
    return failure(error);
  }
}

/** "copy", then "copy 2", … — never overwrite an existing sibling. */
function conflictFreeName(
  directory: string,
  name: string,
  isDirectory: boolean,
  attempt: number,
): string {
  if (attempt === 0) return join(directory, name);
  const dot = isDirectory ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  return join(
    directory,
    `${stem} copy${attempt > 1 ? ` ${attempt}` : ""}${extension}`,
  );
}

export async function copyExplorerEntry(
  root: string,
  source: string,
  destinationDir: string,
): Promise<ExplorerResult> {
  const guarded = await guardExisting(root, source);
  const destination = await guardParent(root, destinationDir);
  if (!guarded || !destination)
    return { ok: false, error: "Path is outside the opened folder" };
  const sourceInfo = await stat(guarded.target).catch(() => null);
  if (!sourceInfo) return { ok: false, error: "Source no longer exists" };
  if (
    sourceInfo.isDirectory() &&
    (destination.parent === guarded.target ||
      inside(guarded.target, destination.parent))
  )
    return { ok: false, error: "Cannot copy a folder into itself" };
  const name = guarded.target.split(/[\\/]/).pop() ?? "";
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const target = conflictFreeName(
        destination.parent,
        name,
        sourceInfo.isDirectory(),
        attempt,
      );
      if (await exists(target)) continue;
      await cp(guarded.target, target, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
      return { ok: true, path: target };
    }
    return { ok: false, error: "Too many files with that name" };
  } catch (error) {
    return failure(error);
  }
}
