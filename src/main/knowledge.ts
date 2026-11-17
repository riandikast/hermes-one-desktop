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
import { join, relative } from "path";

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
  const safeName = bundleName.trim().replace(/[^a-zA-Z0-9_.-]/g, "-");
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
  const { forgetKnowledgeBundleUnlocked, serializeKnowledgePackageOperation } =
    await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, async () => {
    if (
      typeof bundleName !== "string" ||
      !bundleName ||
      bundleName === "." ||
      bundleName === ".." ||
      bundleName.includes("/") ||
      bundleName.includes("\\")
    )
      return false;
    const root = await ensureKnowledgeDir(homeOverride);
    const bundlePath = join(root, bundleName);
    try {
      await forgetKnowledgeBundleUnlocked(bundleName, homeOverride);
      await rm(bundlePath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  });
}

export async function renameKnowledgeBundle(
  bundleName: string,
  newBundleName: string,
  homeOverride?: string,
): Promise<boolean> {
  const {
    serializeKnowledgePackageOperation,
    renameKnowledgeMetadataUnlocked,
  } = await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, async () => {
    const safeName = newBundleName.trim().replace(/[^a-zA-Z0-9_.-]/g, "-");
    if (!safeName || safeName === bundleName) return false;
    const root = await ensureKnowledgeDir(homeOverride),
      oldPath = join(root, bundleName),
      newPath = join(root, safeName);
    try {
      await renameKnowledgeMetadataUnlocked(
        bundleName,
        safeName,
        homeOverride,
        async () => rename(oldPath, newPath),
        async () => rename(newPath, oldPath),
      );
      return true;
    } catch {
      return false;
    }
  });
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
  const {
    serializeKnowledgePackageOperation,
    renameKnowledgeMetadataUnlocked,
  } = await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, async () => {
    if (
      [bundleName, oldFileName, newFileName].some(
        (value) =>
          typeof value !== "string" ||
          !value ||
          value === "." ||
          value === ".." ||
          value.includes("/") ||
          value.includes("\\"),
      )
    )
      return false;
    const root = await ensureKnowledgeDir(homeOverride),
      oldPath = join(root, bundleName, oldFileName),
      newPath = join(root, bundleName, newFileName);
    try {
      await renameKnowledgeMetadataUnlocked(
        `${bundleName}/${oldFileName}`,
        `${bundleName}/${newFileName}`,
        homeOverride,
        async () => rename(oldPath, newPath),
        async () => rename(newPath, oldPath),
      );
      return true;
    } catch {
      return false;
    }
  });
}

export async function deleteKnowledgeFile(
  bundleName: string,
  fileName: string,
  homeOverride?: string,
): Promise<boolean> {
  const { serializeKnowledgePackageOperation } =
    await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, () =>
    deleteKnowledgeFileInternal(bundleName, fileName, homeOverride),
  );
}
async function deleteKnowledgeFileInternal(
  bundleName: string,
  fileName: string,
  homeOverride?: string,
): Promise<boolean> {
  if (
    [bundleName, fileName].some(
      (value) =>
        typeof value !== "string" ||
        !value ||
        value === "." ||
        value === ".." ||
        value.includes("/") ||
        value.includes("\\"),
    )
  )
    return false;
  const root = await ensureKnowledgeDir(homeOverride);
  const filePath = join(root, bundleName, fileName);
  try {
    const { forgetKnowledgeFileUnlocked } = await import("./knowledge-package");
    await forgetKnowledgeFileUnlocked(
      `${bundleName}/${fileName}`,
      homeOverride,
    );
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
  const {
    serializeKnowledgePackageOperation,
    renameKnowledgeMetadataUnlocked,
  } = await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, async () => {
    if (
      [bundleName, fileName, targetBundleName].some(
        (value) =>
          typeof value !== "string" ||
          !value ||
          value === "." ||
          value === ".." ||
          value.includes("/") ||
          value.includes("\\"),
      ) ||
      targetBundleName === bundleName
    )
      return false;
    const root = await ensureKnowledgeDir(homeOverride),
      oldPath = join(root, bundleName, fileName),
      targetDir = join(root, targetBundleName),
      newPath = join(targetDir, fileName);
    try {
      await mkdir(targetDir, { recursive: true });
      await renameKnowledgeMetadataUnlocked(
        `${bundleName}/${fileName}`,
        `${targetBundleName}/${fileName}`,
        homeOverride,
        async () => rename(oldPath, newPath),
        async () => rename(newPath, oldPath),
      );
      return true;
    } catch {
      return false;
    }
  });
}

export async function importKnowledgeFolder(
  sourceFolderPath: string,
  bundleName: string,
  homeOverride?: string,
): Promise<KnowledgeBundle> {
  const { serializeKnowledgePackageOperation } =
    await import("./knowledge-package");
  return serializeKnowledgePackageOperation(homeOverride, () =>
    importKnowledgeFolderInternal(sourceFolderPath, bundleName, homeOverride),
  );
}
async function importKnowledgeFolderInternal(
  sourceFolderPath: string,
  bundleName: string,
  homeOverride?: string,
): Promise<KnowledgeBundle> {
  const root = await ensureKnowledgeDir(homeOverride);
  const safeName = bundleName.trim().replace(/[^a-zA-Z0-9_.-]/g, "-");
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
const KNOWLEDGE_INDEX_HINT_CHARS = 100;

/** Letters/digits only, lowercased: compares a heading with a file name. */
function comparable(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Extract a one-line content hint from a file's text for an index.
 *
 * The hint exists to tell files apart, so lines that carry nothing beyond the
 * listed name are skipped: a heading that only repeats the file name,
 * separator/template lines with no letters or digits (`---`, `{{--`), and a
 * YAML front-matter block, whose `description:` (or `name:`) is preferred.
 * When the first useful line is a SHORT heading, the start of the next useful
 * line is appended, since a bare title is too cryptic to judge relevance. A
 * long line already carries meaning, so no second line is pulled.
 */
function extractKnowledgeHint(content: string, fileName = ""): string {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const stem = comparable(fileName.replace(/\.[^.]+$/, ""));
  const useful: string[] = [];
  let frontMatter = "";
  for (let i = 0; i < lines.length && useful.length < 2; i++) {
    const line = lines[i];
    if (!/[\p{L}\p{N}]/u.test(line)) {
      // `---` opens a front-matter block only before any content.
      if (line === "---" && useful.length === 0) {
        const close = lines.indexOf("---", i + 1);
        if (close > i) {
          for (const field of lines.slice(i + 1, close)) {
            const m = /^(description|name):\s*["']?(.*?)["']?$/i.exec(field);
            if (m && m[2] && (!frontMatter || m[1].toLowerCase() === "description")) frontMatter = m[2];
          }
          i = close;
        }
      }
      continue;
    }
    if (useful.length === 0 && /^#{1,6}\s/.test(line)) {
      const heading = comparable(line);
      // "# Notes.md" or "# Notes,md.md" over Notes.md says nothing new.
      if (stem && heading.startsWith(stem) && /^(md|markdown|txt)*$/.test(heading.slice(stem.length))) continue;
    }
    useful.push(line);
    if (useful.length === 1 && !(/^#{1,6}\s+\S/.test(line) && line.length <= 60)) break;
  }
  // A front-matter description is the author's own summary: prefer it.
  if (frontMatter || useful.length === 0) return frontMatter.slice(0, KNOWLEDGE_INDEX_HINT_CHARS);
  const hint = useful[0].slice(0, KNOWLEDGE_INDEX_HINT_CHARS);
  return useful[1] ? `${hint} — ${useful[1].slice(0, 80)}` : hint;
}

/**
 * Shared header for the Knowledge and workspace-folder indexes. Paths are
 * listed relative to each section's folder (stated once in the section
 * heading) instead of repeating the absolute prefix on every line.
 */
function indexPreamble(subject: string): string {
  return (
    `${subject} (snapshot; files may have changed since). ` +
    "Each file's EXACT absolute path is its section folder joined with the listed path; never guess another. " +
    "Read a file's current content before editing it; a hint is only a pointer, so open the file before judging it irrelevant. " +
    "Don't paste file contents unless asked."
  );
}

/** Index line for one file: relative path plus its hint when it fits. */
function indexLine(relativePath: string, hint: string): string {
  return hint ? `- ${relativePath} — ${hint}` : `- ${relativePath}`;
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
      const pathCost = fileName.length + 4;
      if (budget < pathCost) {
        lines.push(
          `- …and ${files.length - lines.length} more file(s) in this bundle (list the directory to see them all)`,
        );
        break;
      }

      let hint = "";
      try {
        const content = await readFile(fullPath, "utf8");
        hint = extractKnowledgeHint(content, fileName);
      } catch {
        /* hint optional */
      }

      const full = indexLine(fileName, hint);
      // Keep the whole line when it fits; otherwise fall back to path-only so
      // the file remains addressable rather than disappearing.
      if (full.length <= budget) {
        lines.push(full);
        budget -= full.length;
      } else {
        const pathOnly = indexLine(fileName, "");
        if (pathOnly.length <= budget) {
          lines.push(pathOnly);
          budget -= pathOnly.length;
        } else {
          lines.push(
            `- …and ${files.length - lines.length} more file(s) in this bundle (list the directory to see them all)`,
          );
          break;
        }
      }
    }

    if (lines.length === 0) continue;
    sections.push(`## ${name} (${bundlePath})\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";

  return [
    indexPreamble("AUTHORITATIVE knowledge bundles the user maintains"),
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
          hint = extractKnowledgeHint(content, e.name);
        } catch {
          /* hint optional — file may be unreadable/binary */
        }
        const line = indexLine(relative(root, full), hint);
        lines.push(line);
        budget -= line.length;
      }
    }
    if (lines.length === 0) continue;
    const name = root.split(/[\\/]/).filter(Boolean).pop() || root;
    sections.push(`## ${name} (${root})\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";

  return [indexPreamble("Workspace folders the user attached"), ...sections].join("\n\n");
}
