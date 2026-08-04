/**
 * Pure helpers for the per-turn file-changes summary.
 */

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
  return /^[A-Za-z]:[\\/]|\/(?!\/)/.test(trimmed);
}

/** Find the first absolute-path token embedded in arbitrary text (e.g. a
 *  shell command or a human-readable tool description). File-like tokens
 *  (basename with a dot-extension) win over directory-like tokens — a
 *  `terminal` tool's first path is usually its cwd. Handles JSON double
 *  backslash escapes. URL hosts ("https://…") and relative paths are
 *  rejected via explicit preceding-character checks. */
function findAbsolutePathToken(text: string): string | null {
  const winRe = /[A-Za-z]:[\\/][^\s"'`<>|]*/g;
  const posixRe = /[\\/][^\s"'`<>|]+/g;
  let best: { index: number; token: string; fileLike: boolean } | null = null;
  const consider = (
    index: number,
    raw: string,
    fileLike: boolean,
  ): void => {
    const token = raw.replace(/\\\\/g, "\\");
    if (
      !best ||
      (fileLike && !best.fileLike) ||
      (!fileLike && !best.fileLike && index < best.index)
    ) {
      best = { index, token, fileLike };
    }
  };
  for (const m of text.matchAll(winRe)) {
    const prev = m.index > 0 ? text[m.index - 1] : "";
    // Skip drive letters glued to a word ("https:…").
    if (/[A-Za-z]/.test(prev)) continue;
    consider(m.index, m[0], /\.[^\\/]+$/.test(m[0].split(/[\\/]/).pop() ?? ""));
  }
  for (const m of text.matchAll(posixRe)) {
    const prev = m.index > 0 ? text[m.index - 1] : "";
    // Skip "/…" after a letter/digit/colon (relative path or URL host).
    if (/[A-Za-z0-9:]/.test(prev)) continue;
    consider(m.index, m[0], /\.[^\\/]+$/.test(m[0].split(/[\\/]/).pop() ?? ""));
  }
  const winner = best as { token: string } | null;
  return winner ? winner.token : null;
}

/** Normalize git-bash style paths (/c/Users/x → C:\Users\x) and lowercase
 *  drive letters to a Windows-usable form. */
function normalizePath(path: string): string {
  const gitBash = path.match(/^\/([a-zA-Z])(?:\/|$)(.*)$/);
  if (gitBash) {
    const drive = gitBash[1].toUpperCase();
    const rest = gitBash[2] ? `\\${gitBash[2].replace(/\//g, "\\")}` : "\\";
    return `${drive}:${rest}`;
  }
  if (/^[a-z]:/.test(path)) {
    return path[0].toUpperCase() + path.slice(1);
  }
  return path;
}

/**
 * Best-effort extraction of the file path a tool operates on. Accepts an
 * args object, a JSON-encoded args string, or a plain description string
 * (the gateway's `tool.start.context`). Returns null when no absolute path
 * can be found.
 */
export function extractToolPath(args: unknown): string | null {
  let text = "";
  if (isRecord(args)) {
    // 1. Direct keys.
    for (const key of PATH_KEYS) {
      const value = args[key];
      if (typeof value === "string" && looksLikeAbsolutePath(value)) {
        return normalizePath(value.trim());
      }
    }
    try {
      text = JSON.stringify(args);
    } catch {
      text = String(args);
    }
  } else if (typeof args === "string") {
    text = args;
  } else {
    return null;
  }

  // 2. Scan quoted strings (JSON values) for an embedded absolute path.
  const quotedMatches = text.match(/"[^"]*[\\/][^"]*"/g) || [];
  for (const raw of quotedMatches) {
    const token = findAbsolutePathToken(raw.slice(1, -1));
    if (token) return normalizePath(token);
  }
  // 3. Last resort: scan the whole text.
  const token = findAbsolutePathToken(text);
  return token ? normalizePath(token) : null;
}
