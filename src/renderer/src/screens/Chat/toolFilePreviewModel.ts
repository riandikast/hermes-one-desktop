import { isAutoInjectedPrompt } from "./autoPrompts";
import { isBubbleMessage } from "./chatMessages";
import { extractToolPath } from "./fileChanges";
import type { ChatMessage } from "./types";

export const FILE_PREVIEW_LIMIT = 64 * 1024;

export interface FileToolPreview {
  id: string;
  path: string;
  operation: "Read" | "Write" | "Patch";
  status: "running" | "completed" | "failed";
  args: Record<string, unknown>;
}

/** Only explicit file tools qualify; shell output is not file content. */
export function latestFileTool(
  messages: readonly ChatMessage[],
  baseDir?: string,
): FileToolPreview | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (
      isBubbleMessage(row) &&
      row.role === "user" &&
      !isAutoInjectedPrompt(row.content)
    )
      break;
    if (row.kind !== "tool_call") continue;
    const name = row.name.toLowerCase().split("__").at(-1) ?? "";
    const operation = /^(?:read_file|readfile)$/.test(name)
      ? "Read"
      : /^(?:write_file|writefile)$/.test(name)
        ? "Write"
        : /^(?:patch|patch_file|apply_patch|edit_file)$/.test(name)
          ? "Patch"
          : null;
    if (!operation) continue;
    const raw = row.filePreviewArgs ?? row.args;
    if (raw.length > FILE_PREVIEW_LIMIT * 4) return null;
    let args: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value))
        args = value as Record<string, unknown>;
    } catch {
      /* Human-readable start labels can still supply an explicit path. */
    }
    const patch = typeof args.patch === "string" ? args.patch : "";
    const patchPath = patch.match(
      /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m,
    )?.[1];
    const path =
      extractToolPath(args, baseDir) ??
      extractToolPath(patchPath ? { path: patchPath } : raw, baseDir);
    if (!path || path.includes("\0")) return null;
    return {
      id: row.callId,
      path,
      operation,
      status: row.status ?? "running",
      args,
    };
  }
  return null;
}

/** Latest operation per file, scoped to this request; no editor work for inactive tabs. */
export function previewFiles(
  messages: readonly ChatMessage[],
  baseDir?: string,
): FileToolPreview[] {
  const files = new Map<string, FileToolPreview>();
  const completed = new Set(
    messages
      .filter((row) => row.kind === "tool_result")
      .map((row) => (row.kind === "tool_result" ? row.callId : "")),
  );
  for (let i = messages.length - 1; i >= 0 && files.size < 12; i--) {
    const row = messages[i];
    if (
      isBubbleMessage(row) &&
      row.role === "user" &&
      !isAutoInjectedPrompt(row.content)
    )
      break;
    if (row.kind !== "tool_call") continue;
    const file = latestFileTool([row], baseDir);
    if (!file) continue;
    const key = file.path.replace(/\\/g, "/").toLowerCase();
    if (!files.has(key))
      files.set(
        key,
        completed.has(row.callId) && !row.status
          ? { ...file, status: "completed" }
          : file,
      );
  }
  return [...files.values()].reverse();
}

/** Payload edits are a replay, never a claim about unobserved disk contents. */
export function filePreviewText(
  file: FileToolPreview,
  before?: string,
  after?: string,
): { before: string; after: string; excerpt: boolean } {
  const { args, operation } = file;
  if (file.status === "failed")
    return { before: before ?? "", after: before ?? "", excerpt: false };
  // A fast read can race the write and return its already-written result.
  // Replay the authoritative patch hunk instead of an identical before/after.
  if (
    operation === "Patch" &&
    typeof args.old_string === "string" &&
    typeof args.new_string === "string" &&
    (before === undefined || before === after || before === args.new_string)
  ) {
    return { before: args.old_string, after: args.new_string, excerpt: true };
  }
  if (after !== undefined)
    return { before: before ?? "", after, excerpt: false };
  if (operation === "Read")
    return { before: "", after: before ?? "", excerpt: false };
  if (operation === "Write" && typeof args.content === "string") {
    return {
      before: before === args.content ? "" : (before ?? ""),
      after: args.content,
      excerpt: false,
    };
  }
  if (
    typeof args.old_string === "string" &&
    typeof args.new_string === "string"
  ) {
    const old = args.old_string;
    if (
      old &&
      before !== undefined &&
      before.includes(old) &&
      (args.replace_all === true ||
        before.indexOf(old) === before.lastIndexOf(old))
    ) {
      return {
        before,
        after:
          args.replace_all === true
            ? before.split(old).join(args.new_string)
            : before.replace(old, () => args.new_string as string),
        excerpt: false,
      };
    }
    return { before: old, after: args.new_string, excerpt: true };
  }
  // ponytail: multi-file/context patches show the exact payload, not a guessed full-file application.
  return {
    before: "",
    after: typeof args.patch === "string" ? args.patch : (before ?? ""),
    excerpt: !!args.patch,
  };
}

/** One replacement range, linear cost; bounded animation never diffs whole histories. */
export function previewEditRange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  )
    from++;
  // Keep UTF-16 surrogate pairs intact at the change boundary.
  if (from && /[\uD800-\uDBFF]/.test(before[from - 1])) from--;
  let suffix = 0;
  while (
    suffix < before.length - from &&
    suffix < after.length - from &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(after[after.length - suffix])) suffix--;
  return {
    from,
    to: before.length - suffix,
    insert: after.slice(from, after.length - suffix),
  };
}
