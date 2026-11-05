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
  // The backend's canonical post-edit result key (tool result JSON carries
  // the concrete landed path under resolved_path) — the patch tool's args may
  // omit `path` entirely, so the result key is what catches it.
  "resolved_path",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}



function joinPath(base: string, rel: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const parts = base.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join(sep);
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
  const consider = (index: number, raw: string, fileLike: boolean): void => {
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
 * (the gateway's `tool.start.context`). Returns null when no path can be
 * found. `baseDir` (the session cwd) additionally resolves RELATIVE paths —
 * many tools are invoked with `path: "config.yaml"` against the session
 * working directory, which the old absolute-only matcher silently missed.
 */
export function extractToolPath(
  args: unknown,
  baseDir?: string | null,
): string | null {
  let text = "";
  if (isRecord(args)) {
    // 1. Direct keys. Prefer an absolute path even when a relative key appears first.
    let relativePath: string | null = null;
    for (const key of PATH_KEYS) {
      const value = args[key];
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      // Explicit path fields are not shell tokens: spaces and extensionless
      // filenames are valid. Never truncate them with the description scanner.
      if (!trimmed || [...trimmed].some((char) => char.charCodeAt(0) < 32) ||
          (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed))) continue;
      if (/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(trimmed)) {
        return normalizePath(trimmed);
      }
      relativePath = normalizePath(baseDir ? joinPath(baseDir, trimmed) : trimmed);
    }
    if (relativePath) return relativePath;
    try {
      text = JSON.stringify(args);
    } catch {
      text = String(args);
    }
  } else if (typeof args === "string") {
    // JSON-encoded payload: parse it so escaped Windows backslashes
    // ("D:\\Repo\\A.cs" in raw JSON) resolve correctly — the quoted-token
    // scan below treats \\ as an escape and mangles the path (D: + RepoA.cs).
    try {
      const parsed = JSON.parse(args);
      if (isRecord(parsed)) {
        const direct = extractToolPath(parsed, baseDir);
        if (direct) return direct;
      }
    } catch {
      /* plain text description */
    }
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

/** One line of a computed diff, git-style. */
export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/** Explicit file mutations only; shell/build side effects are not agent edits. */
export const FILE_EDIT_TOOL_NAMES = new Set([
  "edit_file", "patch", "write_file", "patch_file", "create_file",
  "delete_file", "move_file", "copy_file", "rename_file", "apply_patch",
  "str_replace", "save_file", "edit", "replace", "remove", "update",
]);

export function isFileEditTool(name: string): boolean {
  return FILE_EDIT_TOOL_NAMES.has(name.toLowerCase().split(/\.|__/).at(-1) ?? "");
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Read all landed paths, never just the first path in a serialized batch result. */
export function fileEditPaths(
  name: string,
  result: unknown,
  args?: unknown,
  baseDir?: string | null,
): string[] {
  if (!isFileEditTool(name)) return [];
  const record = resultRecord(result);
  if (record && (record.error || record.success === false || record.ok === false || record.status === "failed")) return [];
  if (record && Array.isArray(record.files_modified)) {
    const paths = record.files_modified.flatMap((path) => {
      const resolved = typeof path === "string" ? extractToolPath({ path }, baseDir) : null;
      return resolved ? [resolved] : [];
    });
    const unique = new Map<string, string>();
    for (const path of paths) {
      const key = normalizePathKey(path);
      if (!unique.has(key)) unique.set(key, path);
    }
    return [...unique.values()];
  }
  const path = extractToolPath(record ?? result, baseDir) ?? extractToolPath(args, baseDir);
  return path ? [path] : [];
}

/** Case-insensitive, separator-normalized key for deduping change rows: the
 *  stream capture, the transcript derivation and the git diff can report the
 *  same file with different case or slash/backslash forms. */
export function normalizePathKey(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

/** Derive the turn's edited files straight from the TRANSCRIPT — the same
 *  derivation the official desktop uses. Scans the tool-call rows after the
 *  last user message, keeps only file-edit tools whose result landed, and
 *  pulls the concrete path from the result (`resolved_path` / path keys) or
 *  the args (resolved against `baseDir`). Git state is irrelevant: a file
 *  already dirty before the turn still counts when the agent patched it.
 *  Returns display paths, deduped, in first-touched order. */
export function changedFilesFromToolRows(
  messages: ReadonlyArray<{
    kind?: string;
    role?: string;
    callId?: string;
    name?: string;
    args?: string;
    filePreviewArgs?: string;
    content?: string;
    status?: string;
  }>,
  startIndex: number,
  baseDir?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const results = new Map<string, string>();
  for (let i = startIndex; i < messages.length; i++) {
    const row = messages[i];
    if (row.kind === "tool_result" && row.callId && !results.has(row.callId)) {
      results.set(row.callId, row.content ?? "");
    }
  }
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.kind !== "tool_call") continue;
    const name = String(msg.name ?? "").toLowerCase();
    if (!isFileEditTool(name)) continue;
    if (msg.status === "failed") continue;
    // Pair once by stable call id; keep footer derivation linear in history size.
    const resultContent = msg.callId ? results.get(msg.callId) : undefined;
    if (resultContent === undefined) continue;
    for (const path of fileEditPaths(name, resultContent, msg.filePreviewArgs || msg.args || "", baseDir)) {
      const key = normalizePathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
    }
  }
  return out;
}

/** One working-tree entry from the git snapshot (path → status|content). */
export type GitSnapshot = Map<string, string>;

/**
 * Build the turn-start snapshot key for a git entry: status + current content
 * is enough to detect "changed during this turn" — a file that was already
 * dirty before the turn has the SAME key at finalize, so it's excluded.
 */
export function gitSnapshotKey(
  status: string,
  after: string | null,
): string {
  return `${status}|${after ?? ""}`;
}

/**
 * Filter a finalize-time git list against the turn-start snapshot: only
 * entries whose status/content differs from the snapshot "changed during this
 * turn". Entries with no snapshot entry (newly created/untracked this turn)
 * are kept. Returns the paths that actually changed.
 */
export function gitChangedDuringTurn(
  snapshot: GitSnapshot | null | undefined,
  current: ReadonlyArray<{
    path: string;
    status: string;
    after: string | null;
  }>,
): string[] {
  if (!snapshot) return []; // no baseline → cannot attribute, report nothing
  const changed: string[] = [];
  for (const g of current) {
    const key = gitSnapshotKey(g.status, g.after);
    if (snapshot.get(g.path) === key) continue;
    changed.push(g.path);
  }
  return changed;
}

const DIFF_CELL_BUDGET = 1_000_000;

/**
 * Line diff (LCS with common prefix/suffix trimming) between two file
 * contents. Returns null when the remaining middle exceeds the cell budget —
 * callers fall back to a hunk-only or after-only view.
 */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  if (midA.length * midB.length > DIFF_CELL_BUDGET) return null;

  // LCS DP table over the middle (row-major, Int32).
  const m1 = midB.length + 1;
  const lcs = new Int32Array((midA.length + 1) * m1);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * m1 + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * m1 + j + 1] + 1
          : Math.max(lcs[(i + 1) * m1 + j], lcs[i * m1 + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ type: "same", text: a[i] });
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      out.push({ type: "same", text: midA[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * m1 + j] >= lcs[i * m1 + j + 1]) {
      out.push({ type: "del", text: midA[i] });
      i++;
    } else {
      out.push({ type: "add", text: midB[j] });
      j++;
    }
  }
  while (i < midA.length) {
    out.push({ type: "del", text: midA[i] });
    i++;
  }
  while (j < midB.length) {
    out.push({ type: "add", text: midB[j] });
    j++;
  }
  for (let k = endA + 1; k < a.length; k++) {
    out.push({ type: "same", text: a[k] });
  }
  return out;
}
