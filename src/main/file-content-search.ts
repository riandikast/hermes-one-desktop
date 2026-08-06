import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

/**
 * Content search across workspace roots — the backend for the "Find in
 * Files" dialog (Android-Studio Ctrl+Shift+F style). Walks each root
 * recursively, skips heavy/build/vcs dirs and binary or oversized files,
 * and returns every line containing the query (case-insensitive substring),
 * grouped per file with 1-based line numbers.
 */

export interface FileContentMatch {
  /** 1-based line number in the file. */
  line: number;
  /** The full matching line (without the trailing newline). */
  text: string;
}

export interface FileContentSearchResult {
  path: string;
  matches: FileContentMatch[];
}

const EXCLUDED_DIRS = new Set([
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
]);

/** Files larger than this are skipped (likely generated/binary assets). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Maximum number of files returned across all roots. */
const MAX_RESULT_FILES = 200;
/** Maximum matching lines kept per file. */
const MAX_MATCHES_PER_FILE = 200;
/** Maximum number of files SCANNED (bounds worst-case time in huge repos;
 *  scanning stops early once this many files were read. */
const MAX_SCANNED_FILES = 4000;
/** Concurrent file reads/stat calls. Sequential single-threaded reads made a
 *  large repo's search take tens of seconds. */
const CONCURRENCY = 16;

/** Extensions that are never text — skipped before reading. */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "heic",
  "heif",
  "tiff",
  "tif",
  "psd",
  "ai",
  "eps",
  "pdf",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "flv",
  "wmv",
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "wma",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "zst",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "db",
  "sqlite",
  "idx",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
]);

/**
 * Search generation: every new search bumps it, so an in-flight search can
 * check between files and bail out the moment a newer query supersedes it —
 * otherwise rapid typing queued full walks for every stale query.
 */
let searchGeneration = 0;

/** True when the first chunk contains a NUL byte (strong binary signal). */
function looksBinary(buffer: Buffer): boolean {
  const head = buffer.length > 8192 ? buffer.subarray(0, 8192) : buffer;
  return head.includes(0);
}

/**
 * Pure line matcher — extracted for tests. Splits text into lines (handling
 * \r\n / \n / \r), returns 1-based line numbers of lines containing the
 * case-insensitive query, capped at `maxMatches`.
 */
export function findMatchingLines(
  text: string,
  query: string,
  maxMatches = MAX_MATCHES_PER_FILE,
): FileContentMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const lines = text.split(/\r\n|\n|\r/);
  const out: FileContentMatch[] = [];
  for (let i = 0; i < lines.length && out.length < maxMatches; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      out.push({ line: i + 1, text: lines[i] });
    }
  }
  return out;
}

/** Read + match one file; null when skipped or unmatched. Honors the search
 *  generation so superseded searches stop mid-flight. */
async function scanFile(
  full: string,
  needle: string,
  maxMatches: number,
  gen: number,
): Promise<FileContentSearchResult | null> {
  if (searchGeneration !== gen) return null;
  const dot = full.lastIndexOf(".");
  if (dot >= 0 && BINARY_EXTENSIONS.has(full.slice(dot + 1).toLowerCase())) {
    return null;
  }
  let st;
  try {
    st = await stat(full);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
  if (searchGeneration !== gen) return null;

  let buffer: Buffer;
  try {
    buffer = await readFile(full);
  } catch {
    return null;
  }
  if (looksBinary(buffer)) return null;

  const matches = findMatchingLines(
    buffer.toString("utf8"),
    needle,
    maxMatches,
  );
  return matches.length > 0 ? { path: full, matches } : null;
}

/** Map with bounded concurrency, honoring the search generation. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  gen: number,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        if (searchGeneration !== gen) return;
        const i = next++;
        out[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

export async function searchFileContents(
  roots: string[],
  query: string,
  opts: {
    maxFiles?: number;
    maxMatchesPerFile?: number;
  } = {},
): Promise<FileContentSearchResult[]> {
  const needle = query.trim().toLowerCase();
  if (!needle || roots.length === 0) return [];

  const gen = ++searchGeneration;
  const maxFiles = opts.maxFiles ?? MAX_RESULT_FILES;
  const maxMatches = opts.maxMatchesPerFile ?? MAX_MATCHES_PER_FILE;

  // Phase 1: fast walk (readdir only) collecting candidate file paths.
  const paths: string[] = [];
  for (const root of roots) {
    const queue: string[] = [root];
    while (queue.length > 0 && paths.length < MAX_SCANNED_FILES) {
      if (searchGeneration !== gen) return [];
      const dir = queue.shift()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (paths.length >= MAX_SCANNED_FILES) break;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            queue.push(full);
          }
          continue;
        }
        if (entry.name.startsWith(".")) continue;
        paths.push(full);
      }
    }
  }

  // Phase 2: bounded-parallel stat/read/match, cancelling stale generations.
  const scanned = await mapConcurrent(
    paths,
    CONCURRENCY,
    (p) => scanFile(p, needle, maxMatches, gen),
    gen,
  );
  const results = scanned.filter(
    (r): r is FileContentSearchResult => r !== null,
  );
  return results.slice(0, maxFiles);
}
