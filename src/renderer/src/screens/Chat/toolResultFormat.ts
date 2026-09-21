/**
 * Human-readable presentation of a tool result.
 *
 * Tool results arrive as JSON ENVELOPES, not as text: a terminal call returns
 * `{"output": "...", "exit_code": 0, "error": null}`, a file read returns
 * `{"content": "...", "total_lines": 428, "truncated": false}`, a patch returns
 * `{"success": true, "diff": "...", "files_modified": [...]}`. Dumping the
 * envelope as pretty-printed JSON buries the actual payload inside a single
 * escaped string ("line1\nline2\nline3") — correct, but unreadable.
 *
 * So: recognise the envelope, pull the payload out, and surface the metadata
 * as its own fields. Anything unrecognised falls back to plain text, and a
 * genuinely non-envelope JSON blob still pretty-prints.
 *
 * Pure and dependency-free so it can be unit-tested directly.
 */

export type ResultTone = "ok" | "error" | "neutral";

/** One labelled part of a formatted result. */
export interface ResultSection {
  /** Section heading ("Output", "Diff", "File content"). */
  label: string;
  /** The payload text, already unescaped. */
  body: string;
  /** Syntax hint for the code renderer. */
  language: string;
}

export interface FormattedToolResult {
  tone: ResultTone;
  /** Primary label for the result block ("Result" / "Error"). */
  title: string;
  /** Short metadata chips, rendered beside the title (e.g. "exit 1"). */
  meta: string[];
  sections: ResultSection[];
}

/** Payload keys, most specific first — the first present one wins. */
const BODY_KEYS: ReadonlyArray<{ key: string; label: string; language: string }> =
  [
    { key: "diff", label: "Diff", language: "diff" },
    { key: "patch", label: "Patch", language: "diff" },
    { key: "output", label: "Output", language: "text" },
    { key: "stdout", label: "Output", language: "text" },
    { key: "content", label: "File content", language: "text" },
    { key: "text", label: "Text", language: "text" },
    { key: "result", label: "Result", language: "text" },
    { key: "message", label: "Message", language: "text" },
    { key: "summary", label: "Summary", language: "text" },
    { key: "question", label: "Question", language: "text" },
  ];

/**
 * Keys that describe the result rather than carry it. Rendered as compact
 * metadata instead of being dumped into the body.
 */
const META_KEYS: ReadonlyArray<string> = [
  "exit_code",
  "status",
  "success",
  "duration_seconds",
  "tool_calls_made",
  "total_lines",
  "file_size",
  "bytes_written",
  "truncated",
  "stdout_truncated",
  "is_binary",
  "is_image",
  "resolved_path",
  "pid",
  "session_id",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse a string that is entirely a JSON value; null when it is not. */
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatMetaValue(key: string, value: unknown): string | null {
  switch (key) {
    case "exit_code":
      return `exit ${String(value)}`;
    case "duration_seconds":
      return typeof value === "number" ? `${value.toFixed(1)}s` : null;
    case "tool_calls_made":
      return `${String(value)} tool call${value === 1 ? "" : "s"}`;
    case "total_lines":
      return `${String(value)} lines`;
    case "file_size":
      return typeof value === "number" ? `${value.toLocaleString()} bytes` : null;
    case "bytes_written":
      return typeof value === "number" ? `${value.toLocaleString()} bytes written` : null;
    case "success":
      // Redundant when the tone already reflects it.
      return value === false ? "failed" : null;
    case "truncated":
    case "stdout_truncated":
      return value === true ? "truncated" : null;
    case "is_binary":
      return value === true ? "binary" : null;
    case "is_image":
      return value === true ? "image" : null;
    case "verification_evidence":
      // Free prose, not a chip.
      return null;
    case "status":
      // "exited" on every terminal result is noise next to the exit code.
      return typeof value === "string" && value && value !== "exited"
        ? value
        : null;
    case "resolved_path":
      // Already the body of a file section when present; only chip it for
      // envelopes that carry no other payload.
      return null;
    default:
      return null;
  }
}

function collectMeta(record: Record<string, unknown>): string[] {
  const meta: string[] = [];
  for (const key of META_KEYS) {
    if (!(key in record)) continue;
    const formatted = formatMetaValue(key, record[key]);
    if (formatted) meta.push(formatted);
  }
  return meta;
}

/** A non-empty error string means the call failed, whatever else it says. */
function errorText(record: Record<string, unknown>): string | null {
  const raw = record.error;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") return JSON.stringify(raw, null, 2);
  return null;
}

/** Render a list of strings as a column. */
function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "path" in item
          ? String((item as { path: unknown }).path)
          : null,
    )
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Structured payloads that read better as purpose-built text than as JSON:
 *   - todo lists:      {todos: [{content, status}]}
 *   - skill ops:       {operations_applied, results: [{name, action, success}]}
 *   - file listings:   {files: [...]} / {files_modified: [...]}
 * Returns [] when none match, so the caller falls through to the plain keys.
 */
function structuredSections(record: Record<string, unknown>): ResultSection[] {
  const sections: ResultSection[] = [];

  // Todo list — a checked list reads far better than the raw objects.
  const todos = record.todos;
  if (Array.isArray(todos) && todos.length > 0) {
    const lines = todos.map((entry) => {
      const row = asRecord(entry);
      if (!row) return null;
      const status = typeof row.status === "string" ? row.status : "";
      const mark =
        status === "completed" ? "[x]" : status === "in_progress" ? "[~]" : "[ ]";
      const content = typeof row.content === "string" ? row.content : "";
      return `${mark} ${content}${status ? `  (${status})` : ""}`;
    });
    const body = lines.filter((l): l is string => l !== null).join("\n");
    if (body) sections.push({ label: "Todos", body, language: "text" });
  }

  // Skill-manage operations — one line per op, with the target.
  const operations = record.results;
  const applied = record.operations_applied;
  if (
    typeof applied === "number" &&
    Array.isArray(operations) &&
    operations.length > 0
  ) {
    const lines = operations.map((entry) => {
      const row = asRecord(entry);
      if (!row) return null;
      const name = typeof row.name === "string" ? row.name : "skill";
      const action = typeof row.action === "string" ? row.action : "applied";
      const target = typeof row.file_path === "string" ? ` · ${row.file_path}` : "";
      const mark = row.success === false ? "✗" : "✓";
      return `${mark} ${action} ${name}${target}`;
    });
    const body = lines.filter((l): l is string => l !== null).join("\n");
    if (body) {
      sections.push({
        label: `Skills (${applied} operation${applied === 1 ? "" : "s"})`,
        body,
        language: "text",
      });
    }
  }

  // File listings — one path per line instead of a JSON array on one line.
  for (const key of ["files_modified", "files", "files_read", "files_written"] as const) {
    const list = asList(record[key]);
    if (list.length === 0) continue;
    const label =
      key === "files_modified" || key === "files_written"
        ? `Files (${list.length})`
        : key === "files_read"
          ? `Read (${list.length})`
          : `Files (${list.length})`;
    sections.push({ label, body: list.join("\n"), language: "text" });
  }

  return sections;
}

function looksFailed(text: string): boolean {
  return /\b(error|failed|failure|exception|traceback)\b/i.test(text);
}

/**
 * Format a tool result for display. Never throws; always returns at least one
 * section so the block is never empty.
 */
export function formatToolResult(content: string): FormattedToolResult {
  const raw = content ?? "";
  const parsed = parseJson(raw);
  const record = asRecord(parsed);

  if (!record) {
    const text = raw || "(no result)";
    const failed = looksFailed(text);
    return {
      tone: failed ? "error" : "neutral",
      title: failed ? "Error" : "Result",
      meta: [],
      sections: [{ label: failed ? "Error" : "Result", body: text, language: "text" }],
    };
  }

  const error = errorText(record);
  const exitCode = record.exit_code;
  const failed =
    error !== null || (typeof exitCode === "number" && exitCode !== 0);

  // Background/wait results echo the command back. Showing it as a section
  // beats burying the invocation in a metadata chip.
  const echoedCommand =
    typeof record.command === "string" && record.command.trim()
      ? record.command
      : null;

  const sections: ResultSection[] = [];
  if (echoedCommand) {
    sections.push({ label: "Command", body: echoedCommand, language: "bash" });
  }

  // A structured payload we know how to render nicely (todos, skill ops,
  // file lists). Checked before the plain string keys below.
  const structured = structuredSections(record);
  if (structured.length > 0) sections.push(...structured);

  for (const { key, label, language } of BODY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      sections.push({ label, body: value, language });
    }
  }

  // An error envelope with no other payload still needs to show the message.
  if (error !== null && sections.length === 0) {
    sections.push({ label: "Error", body: error, language: "text" });
  }

  if (sections.length === 0) {
    // Recognised JSON but nothing we know how to unwrap (e.g. a bare array
    // result). Show the structured form rather than losing information.
    sections.push({
      label: "Result",
      body: JSON.stringify(parsed, null, 2),
      language: "json",
    });
  }

  return {
    tone: failed ? "error" : "ok",
    title: failed ? "Error" : "Result",
    meta: collectMeta(record),
    sections,
  };
}
