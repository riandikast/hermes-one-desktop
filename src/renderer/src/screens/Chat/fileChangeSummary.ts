import { isAutoInjectedPrompt } from "./autoPrompts";
import { isBubbleMessage } from "./chatMessages";
import { changedFilesFromToolRows, normalizePathKey } from "./fileChanges";
import type { ChatMessage, FileChange, FileChangesMessage } from "./types";

/** Runtime notices and recovery prompts remain inside the last manual request. */
export function lastManualPromptIndex(messages: readonly ChatMessage[]): number {
  return messages.findLastIndex((row) => isBubbleMessage(row) && row.role === "user" && !isAutoInjectedPrompt(row.content));
}

/** Preserve the earliest baseline (including creation), but take the latest result. */
export function mergePromptFileChanges(previous: readonly FileChange[], latest: readonly FileChange[]): FileChange[] {
  const merged = new Map(previous.map((change) => [normalizePathKey(change.path), change]));
  for (const change of latest) {
    const key = normalizePathKey(change.path);
    const first = merged.get(key);
    merged.set(key, first ? {
      ...change,
      path: first.path,
      before: first.before !== null || first.beforeKnown ? first.before : change.before,
      beforeKnown: first.beforeKnown || change.beforeKnown,
      removed: first.removed ?? change.removed,
    } : change);
  }
  return [...merged.values()];
}

/** Upsert the same summary within this manual prompt, never a prior prompt. */
export function updatePromptFileSummary(messages: ChatMessage[], changes: FileChange[], promptId?: string): ChatMessage[] {
  const owner = promptId === undefined ? lastManualPromptIndex(messages)
    : messages.findIndex((row) => row.id === promptId && isBubbleMessage(row) && row.role === "user");
  if (owner < 0) return messages;
  const start = owner + 1;
  const following = messages.findIndex((row, index) => index >= start && isBubbleMessage(row) &&
    row.role === "user" && !isAutoInjectedPrompt(row.content));
  const end = following < 0 ? messages.length : following;
  const rows = messages.slice(start, end);
  const chips = rows.filter((row): row is FileChangesMessage => row.kind === "file_changes");
  const prompt = messages[owner];
  const previous = rows.reduce<FileChange[]>((all, row) => {
    const snapshots = row.kind === "file_changes" ? row.changes
      : "fileChanges" in row ? row.fileChanges : undefined;
    return snapshots ? mergePromptFileChanges(all, snapshots) : all;
  }, "fileChanges" in prompt ? prompt.fileChanges ?? [] : []);
  const chip: FileChangesMessage = {
    id: chips[0]?.id ?? `fc-${prompt.id}`,
    kind: "file_changes", role: "agent", changes: mergePromptFileChanges(previous, changes),
  };
  return [...messages.slice(0, start), ...rows.filter((row) => row.kind !== "file_changes"), chip, ...messages.slice(end)];
}

/** Positive canonical owner only; never infer ownership from repeated prompt text. */
export function promptFileChangeOwner(messages: readonly ChatMessage[], promptId: string): number | null {
  const prompt = messages.find((row) => row.id === promptId);
  if (!prompt || !isBubbleMessage(prompt) || prompt.role !== "user") return null;
  const id = prompt.canonicalDbId ?? Number(prompt.id.match(/^db-(\d+)$/)?.[1]);
  return Number.isSafeInteger(id) && id! > 0 ? id! : null;
}

/** Presentation only: one footer per manual prompt; retain raw snapshots for history. */
export function fileSummaryFooters(messages: readonly ChatMessage[], isLoading: boolean): ChatMessage[] {
  const output: ChatMessage[] = [];
  let summary: FileChangesMessage | undefined;
  let rows: ChatMessage[] = [];
  const flush = (): void => {
    // Restore archived prompt snapshots when present; landed tool rows also
    // recover path-only chips for older turns without a provable archive owner.
    const paths = changedFilesFromToolRows(rows, 0).map((path) => ({ path, before: null, after: null, beforeKnown: false }));
    if (paths.length || summary) output.push({
      id: summary?.id ?? `fc-${rows[0]?.id ?? "session"}`,
      kind: "file_changes", role: "agent",
      changes: mergePromptFileChanges(paths, summary?.changes ?? []),
    });
    summary = undefined;
    rows = [];
  };
  for (const row of messages) {
    if (isBubbleMessage(row) && row.role === "user" && !isAutoInjectedPrompt(row.content)) flush();
    rows.push(row);
    const changes = row.kind === "file_changes" ? row.changes
      : "fileChanges" in row ? row.fileChanges : undefined;
    if (changes?.length) summary = {
      id: summary?.id ?? (row.kind === "file_changes" ? row.id : `fc-${row.id}`),
      kind: "file_changes", role: "agent",
      changes: mergePromptFileChanges(summary?.changes ?? [], changes),
    };
    if (row.kind !== "file_changes") output.push(row);
  }
  if (!isLoading) flush();
  return output;
}
