import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface KnowledgeFile {
  name: string;
  relativePath: string;
  path: string;
  size: number;
}

export interface KnowledgeBundle {
  name: string;
  path: string;
  files: KnowledgeFile[];
}

export function getKnowledgeDir(homeOverride?: string): string {
  const base =
    homeOverride || process.env.HERMES_HOME || join(homedir(), ".hermes");
  return join(base, "knowledge");
}

export async function ensureKnowledgeDir(
  homeOverride?: string,
): Promise<string> {
  const dir = getKnowledgeDir(homeOverride);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function listKnowledgeBundles(
  homeOverride?: string,
): Promise<KnowledgeBundle[]> {
  const root = await ensureKnowledgeDir(homeOverride);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const bundles: KnowledgeBundle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const bundleName = entry.name;
    const bundlePath = join(root, bundleName);

    const files: KnowledgeFile[] = [];
    try {
      const subEntries = await readdir(bundlePath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isDirectory()) continue;
        const filePath = join(bundlePath, sub.name);
        const st = await stat(filePath);
        files.push({
          name: sub.name,
          relativePath: `${bundleName}/${sub.name}`,
          path: filePath,
          size: st.size,
        });
      }
    } catch {
      /* ignore read errors on bundle */
    }

    bundles.push({
      name: bundleName,
      path: bundlePath,
      files,
    });
  }

  return bundles;
}

export async function createKnowledgeBundle(
  bundleName: string,
  homeOverride?: string,
): Promise<KnowledgeBundle> {
  const safeName = bundleName.trim().replace(/[^a-zA-Z0-9_\-\.]/g, "-");
  if (!safeName) throw new Error("Invalid bundle name");
  const root = await ensureKnowledgeDir(homeOverride);
  const bundlePath = join(root, safeName);
  await mkdir(bundlePath, { recursive: true });
  return {
    name: safeName,
    path: bundlePath,
    files: [],
  };
}

export async function deleteKnowledgeBundle(
  bundleName: string,
  homeOverride?: string,
): Promise<boolean> {
  const root = await ensureKnowledgeDir(homeOverride);
  const bundlePath = join(root, bundleName);
  try {
    await rm(bundlePath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function renameKnowledgeBundle(
  bundleName: string,
  newBundleName: string,
  homeOverride?: string,
): Promise<boolean> {
  const safeName = newBundleName.trim().replace(/[^a-zA-Z0-9_\-\.]/g, "-");
  if (!safeName || safeName === bundleName) return false;
  const root = await ensureKnowledgeDir(homeOverride);
  const oldPath = join(root, bundleName);
  const newPath = join(root, safeName);
  if (oldPath === newPath) return false;
  try {
    await rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

export async function readKnowledgeFile(
  bundleName: string,
  fileName: string,
  homeOverride?: string,
): Promise<string | null> {
  const root = await ensureKnowledgeDir(homeOverride);
  const filePath = join(root, bundleName, fileName);
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function writeKnowledgeFile(
  bundleName: string,
  fileName: string,
  content: string,
  homeOverride?: string,
): Promise<boolean> {
  const root = await ensureKnowledgeDir(homeOverride);
  const bundleDir = join(root, bundleName);
  await mkdir(bundleDir, { recursive: true });
  const filePath = join(bundleDir, fileName);
  try {
    await writeFile(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function renameKnowledgeFile(
  bundleName: string,
  oldFileName: string,
  newFileName: string,
  homeOverride?: string,
): Promise<boolean> {
  const root = await ensureKnowledgeDir(homeOverride);
  const oldPath = join(root, bundleName, oldFileName);
  const newPath = join(root, bundleName, newFileName);
  try {
    await rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteKnowledgeFile(
  bundleName: string,
  fileName: string,
  homeOverride?: string,
): Promise<boolean> {
  const root = await ensureKnowledgeDir(homeOverride);
  const filePath = join(root, bundleName, fileName);
  try {
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function moveKnowledgeFile(
  bundleName: string,
  fileName: string,
  targetBundleName: string,
  homeOverride?: string,
): Promise<boolean> {
  if (!targetBundleName || targetBundleName === bundleName) return false;
  const root = await ensureKnowledgeDir(homeOverride);
  const oldPath = join(root, bundleName, fileName);
  const targetDir = join(root, targetBundleName);
  const newPath = join(targetDir, fileName);
  try {
    await mkdir(targetDir, { recursive: true });
    await rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

export async function importKnowledgeFolder(
  sourceFolderPath: string,
  bundleName: string,
  homeOverride?: string,
): Promise<KnowledgeBundle> {
  const root = await ensureKnowledgeDir(homeOverride);
  const safeName = bundleName.trim().replace(/[^a-zA-Z0-9_\-\.]/g, "-");
  const destDir = join(root, safeName);
  await mkdir(destDir, { recursive: true });
  await cp(sourceFolderPath, destDir, { recursive: true });
  const bundles = await listKnowledgeBundles(homeOverride);
  const found = bundles.find((b) => b.name === safeName);
  return found || { name: safeName, path: destDir, files: [] };
}

/** Cap for the assembled index (chars). A single shared budget let the first
 *  bundles starve the rest, so it is now split EQUALLY per enabled bundle
 *  (see `buildKnowledgeIndex`); the per-bundle floor below keeps that split
 *  useful when many bundles are toggled at once. */
const KNOWLEDGE_INDEX_MAX_CHARS = 2000;
/** Floor for one bundle's share, so a large bundle count cannot shrink a
 *  single bundle below "enough to list its file paths". */
const KNOWLEDGE_INDEX_MIN_BUNDLE_CHARS = 600;
/** Per-file hint length: first line of the file, truncated. */
const KNOWLEDGE_INDEX_HINT_CHARS = 140;

/**
 * Extract a one-line content hint from a knowledge file's text for the system
 * index. The first non-empty line is the primary cue (usually a markdown
 * heading or a title). When that line is a SHORT heading, the title alone is
 * too cryptic for the model to judge relevance, so the start of the next
 * non-empty line is appended. A long first line already carries meaning, so we
 * don't pull a second line in that case (keeps the hint within budget and
 * avoids leaking content past the pointer).
 */
function extractKnowledgeHint(content: string): string {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  let firstIdx = 0;
  while (firstIdx < lines.length && lines[firstIdx].length === 0) firstIdx++;
  const first = lines[firstIdx] ?? "";
  const hint = first.slice(0, KNOWLEDGE_INDEX_HINT_CHARS);
  // Append the next non-empty line when the first line is a SHORT heading —
  // a bare title is too cryptic to distinguish files (the model then guesses
  // the wrong file when told to write to "the knowledge file").
  if (/^#{1,6}\s+\S/.test(first) && first.length <= 60) {
    for (let j = firstIdx + 1; j < lines.length; j++) {
      if (lines[j].length > 0) {
        return `${hint} — ${lines[j].slice(0, 80)}`;
      }
    }
  }
  return hint;
}

/**
 * Build a lightweight text index of the given knowledge bundles for system
 * prompt injection. Lists each bundle's files with a one-line content hint so
 * the model can judge relevance and read/update the full file with its file
 * tools when relevant. Returns "" when no bundles are named (callers can skip
 * injection entirely).
 */
export async function buildKnowledgeIndex(
  bundleNames: string[],
  homeOverride?: string,
): Promise<string> {
  const names = [
    ...new Set((bundleNames || []).map((n) => n.trim()).filter(Boolean)),
  ];
  if (names.length === 0) return "";

  const root = await ensureKnowledgeDir(homeOverride);

  // Collect every bundle's full file list FIRST, so the budget is split fairly.
  // A single shared budget consumed in bundle order silently dropped whatever
  // came last (a 6-bundle set blew 2000 chars before the final bundles, so an
  // enabled bundle's files were never listed and the agent could not find a
  // file the user could see). Each bundle now gets an equal share, and within a
  // bundle every file gets at least its path — hints degrade before paths do.
  const collected: Array<{ name: string; files: string[] }> = [];
  for (const name of names) {
    const bundlePath = join(root, name);
    try {
      const files = (await readdir(bundlePath, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
      if (files.length > 0) collected.push({ name, files });
    } catch {
      continue; // bundle missing/unreadable — skip it
    }
  }
  if (collected.length === 0) return "";

  const perBundle = Math.max(
    KNOWLEDGE_INDEX_MIN_BUNDLE_CHARS,
    Math.floor(KNOWLEDGE_INDEX_MAX_CHARS / collected.length),
  );

  const sections: string[] = [];
  for (const { name, files } of collected) {
    const bundlePath = join(root, name);
    let budget = perBundle;
    const lines: string[] = [];

    for (const fileName of files) {
      const fullPath = join(bundlePath, fileName);
      // The PATH is the load-bearing part (the agent must be able to open the
      // file); never drop a file while there is room for its path alone.
      const pathCost = fullPath.length + 4;
      if (budget < pathCost) {
        lines.push(`- …and ${files.length - lines.length} more file(s) in this bundle (list the directory to see them all)`);
        break;
      }

      let hint = "";
      try {
        const content = await readFile(fullPath, "utf8");
        hint = extractKnowledgeHint(content);
      } catch {
        /* hint optional */
      }

      const full = hint ? `- ${fullPath} — ${hint}` : `- ${fullPath}`;
      // Keep the whole line when it fits; otherwise fall back to path-only so
      // the file remains addressable rather than disappearing.
      if (full.length <= budget) {
        lines.push(full);
        budget -= full.length;
      } else {
        const pathOnly = `- ${fullPath}`;
        if (pathOnly.length <= budget) {
          lines.push(pathOnly);
          budget -= pathOnly.length;
        } else {
          lines.push(`- …and ${files.length - lines.length} more file(s) in this bundle (list the directory to see them all)`);
          break;
        }
      }
    }

    if (lines.length === 0) continue;
    sections.push(`## ${name}\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";

  return [
    "The user maintains the knowledge bundles below as AUTHORITATIVE context for this conversation. This index is a SNAPSHOT taken when the conversation started — before writing to a knowledge file, use your file tools to list the knowledge directory and read the CURRENT content of the target file, and write to the EXACT absolute path listed below (never invent or guess a path or filename). The hint line is only a pointer; open the file to see its full content before deciding it is not relevant. Do not dump file contents into the conversation unless the user explicitly asks.",
    ...sections,
  ].join("\n\n");
}

/** Directories skipped when indexing a workspace folder (vcs, build, deps). */
const FOLDER_INDEX_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".cache",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".idea",
  ".vscode",
  "coverage",
  ".turbo",
  ".parcel-cache",
  ".dart_tool",
  "Pods",
]);

/** Cap on the number of lines listed per folder (bounds the walk). */
const FOLDER_INDEX_MAX_LINES_PER_FOLDER = 40;

/**
 * Build a lightweight index of the attached workspace folder(s) for system
 * prompt injection — the same shape as [[buildKnowledgeIndex]] but for
 * arbitrary absolute folder paths. The model learns the folder's structure by
 * DEFAULT (no @mention required), matching how harnesses surface attached
 * workspaces: a file map with one-line hints, read on demand with file tools.
 */
export async function buildFolderIndex(folders: string[]): Promise<string> {
  const roots = [
    ...new Set((folders || []).map((f) => f.trim()).filter(Boolean)),
  ];
  if (roots.length === 0) return "";

  const sections: string[] = [];
  let budget = KNOWLEDGE_INDEX_MAX_CHARS;

  for (const root of roots) {
    if (budget <= 0) break;
    const lines: string[] = [];
    const queue: string[] = [root];
    while (
      queue.length > 0 &&
      lines.length < FOLDER_INDEX_MAX_LINES_PER_FOLDER
    ) {
      const dir = queue.shift()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (lines.length >= FOLDER_INDEX_MAX_LINES_PER_FOLDER) break;
        if (budget <= 0) break;
        if (e.isDirectory()) {
          if (
            !FOLDER_INDEX_EXCLUDED_DIRS.has(e.name) &&
            !e.name.startsWith(".")
          ) {
            queue.push(join(dir, e.name));
          }
          continue;
        }
        if (e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        let hint = "";
        try {
          const st = await stat(full);
          if (!st.isFile() || st.size > 256 * 1024) continue;
          const content = await readFile(full, "utf8");
          hint = extractKnowledgeHint(content);
        } catch {
          /* hint optional — file may be unreadable/binary */
        }
        const line = hint ? `- ${full} — ${hint}` : `- ${full}`;
        lines.push(line);
        budget -= line.length;
      }
    }
    if (lines.length === 0) continue;
    const name = root.split(/[\\/]/).filter(Boolean).pop() || root;
    sections.push(`## ${name}\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";

  return [
    "The user attached the following workspace folders as context. This index is a SNAPSHOT taken when the conversation started — before writing to a file, use your file tools to list the folder and read the CURRENT content of the target file, and write to the EXACT absolute path listed below (never invent or guess a path or filename). The hint line is only a pointer, so open the file to see its full content before deciding it is not relevant. Do not dump file contents into the conversation unless the user explicitly asks.",
    ...sections,
  ].join("\n\n");
}
