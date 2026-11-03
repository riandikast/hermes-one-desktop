import { isAutoInjectedPrompt } from "./autoPrompts";
import { isBubbleMessage } from "./chatMessages";
import { normalizePathKey } from "./fileChanges";
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
export function updatePromptFileSummary(messages: ChatMessage[], changes: FileChange[]): ChatMessage[] {
  const start = lastManualPromptIndex(messages) + 1;
  const chips = messages.slice(start).filter((row): row is FileChangesMessage => row.kind === "file_changes");
  const previous = messages.slice(start).reduce<FileChange[]>((all, row) => {
    const snapshots = row.kind === "file_changes" ? row.changes
      : isBubbleMessage(row) && row.role === "agent" ? row.fileChanges : undefined;
    return snapshots ? mergePromptFileChanges(all, snapshots) : all;
  }, []);
  const chip: FileChangesMessage = {
    id: chips[0]?.id ?? `fc-${messages[start - 1]?.id ?? "session"}`,
    kind: "file_changes", role: "agent", changes: mergePromptFileChanges(previous, changes),
  };
  return [...messages.filter((row, index) => index < start || row.kind !== "file_changes"), chip];
}

/** Presentation only: one footer per manual prompt; retain raw snapshots for history. */
export function fileSummaryFooters(messages: readonly ChatMessage[], isLoading: boolean): ChatMessage[] {
  const output: ChatMessage[] = [];
  let summary: FileChangesMessage | undefined;
  const flush = (): void => { if (summary) output.push(summary); summary = undefined; };
  for (const row of messages) {
    if (isBubbleMessage(row) && row.role === "user" && !isAutoInjectedPrompt(row.content)) flush();
    const changes = row.kind === "file_changes" ? row.changes
      : isBubbleMessage(row) && row.role === "agent" ? row.fileChanges : undefined;
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
