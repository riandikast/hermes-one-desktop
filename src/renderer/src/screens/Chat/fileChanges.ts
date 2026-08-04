/**
 * Pure helpers for the per-turn file-changes summary.
 */

const ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]|\/(?!\/)/;

/** Candidate keys for a file path inside a tool-call args object. */
const PATH_KEYS = [
  "path",
  "file_path",
  "filepath",
  "file",
  "target",
  "filename",
  "absolute_path",
  "absolutePath",
  "dest",
  "destination",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeAbsolutePath(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  // Windows drive letter (C:\...) or POSIX absolute (/...). Reject
  // whitespace/quotes so "my file path" or JSON noise don't match.
  if (/[\s"']/.test(trimmed)) return false;
  return ABSOLUTE_PATH_RE.test(trimmed);
}

/**
 * Best-effort extraction of the file path a write tool operates on.
 * Returns null when no absolute path can be found.
 */
export function extractToolPath(args: unknown): string | null {
  if (!isRecord(args)) return null;

  // 1. Direct keys.
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && looksLikeAbsolutePath(value)) {
      return value.trim();
    }
  }

  // 2. Scan the stringified args for the first absolute path.
  let jsonText = "";
  try {
    jsonText = JSON.stringify(args);
  } catch {
    jsonText = String(args);
  }
  const matches = jsonText.match(/"[^"]*[\\/][^"]*"/g) || [];
  for (const raw of matches) {
    const candidate = raw.slice(1, -1);
    if (looksLikeAbsolutePath(candidate)) return candidate;
  }
  return null;
}
