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

  const maxFiles = opts.maxFiles ?? MAX_RESULT_FILES;
  const maxMatches = opts.maxMatchesPerFile ?? MAX_MATCHES_PER_FILE;
  const results: FileContentSearchResult[] = [];

  for (const root of roots) {
    const queue: string[] = [root];
    while (queue.length > 0 && results.length < maxFiles) {
      const dir = queue.shift()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            queue.push(full);
          }
          continue;
        }
        if (entry.name.startsWith(".")) continue;

        let st;
        try {
          st = await stat(full);
        } catch {
          continue;
        }
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;

        let buffer: Buffer;
        try {
          buffer = await readFile(full);
        } catch {
          continue;
        }
        if (looksBinary(buffer)) continue;

        const matches = findMatchingLines(
          buffer.toString("utf8"),
          needle,
          maxMatches,
        );
        if (matches.length > 0) {
          results.push({ path: full, matches });
        }
      }
    }
    if (results.length >= maxFiles) break;
  }

  return results;
}
