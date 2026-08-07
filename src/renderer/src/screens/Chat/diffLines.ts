/**
 * Unified-diff primitives ported from the official desktop's
 * `components/chat/diff-lines.tsx` (NousResearch/hermes-agent). The backend
 * ships file-edit diffs as an opaque unified-diff string on `tool.complete`
 * (`payload.inline_diff`), so the renderer only needs a parser + counters —
 * no before/after snapshots.
 */

export type DiffLineKind = "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  newNo?: number;
  oldNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split a unified diff into `@@` hunks. Lines before the first hunk are
 *  dropped (file headers). */
export function parseHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo: number | undefined;
  let newNo: number | undefined;

  for (const line of diff.split(/\r?\n/)) {
    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      current = {
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
        body: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.body.push({ kind: "add", text: line.slice(1), newNo });
      newNo = newNo !== undefined ? newNo + 1 : undefined;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.body.push({ kind: "remove", text: line.slice(1), oldNo });
      oldNo = oldNo !== undefined ? oldNo + 1 : undefined;
    } else {
      current.body.push({ kind: "context", text: line.slice(1), oldNo, newNo });
      if (oldNo !== undefined) oldNo += 1;
      if (newNo !== undefined) newNo += 1;
    }
  }
  return hunks;
}

/** Flatten a diff into ordered lines (headers excluded). */
export function parseDiff(diff: string): DiffLine[] {
  return parseHunks(diff).flatMap((hunk) => hunk.body);
}

/** Count +/− content lines, excluding `+++`/`---` header lines. */
export function countDiffLineStats(
  diff: string,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/** Strip ANSI color codes and the backend's leading `┊ review diff` marker
 *  line the inline diff can be prefixed with. */
export function stripDiffChrome(diff: string): string {
  const cleaned = diff.replace(ANSI_RE, "").trim();
  const lines = cleaned
    .split(/\r?\n/)
    .filter((l) => !l.includes("┊ review diff"));
  return lines.join("\n");
}

/** Scrape the edited file path from `--- a/<p>` / `+++ b/<p>` headers or the
 *  Hermes arrow form `a/<p> → b/<p>`. Returns null when absent. */
export function filePathFromInlineDiff(diff: string): string | null {
  const stripped = stripDiffChrome(diff);
  const arrow = /a\/(.+?)\s*→\s*b\//.exec(stripped);
  if (arrow) return arrow[1].trim();
  const fromHeader = /^---\s+a\/(.+)$/m.exec(stripped);
  if (fromHeader) return fromHeader[1].trim();
  const toHeader = /^\+\+\+\s+b\/(.+)$/m.exec(stripped);
  if (toHeader) return toHeader[1].trim();
  return null;
}

/** True when the payload carries a usable file-edit diff (official
 *  `gatewayEventCompletedFileDiff` equivalent). */
export function inlineDiffFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const raw = payload.inline_diff;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return stripDiffChrome(raw);
}
