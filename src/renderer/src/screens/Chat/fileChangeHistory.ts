import { isAutoInjectedPrompt } from "./autoPrompts";
import { isBubbleMessage } from "./chatMessages";
import { changedFilesFromToolRows, normalizePathKey } from "./fileChanges";
import { dbItemsToChatMessages, type DbHistoryItem } from "./sessionHistory";
import type { ChatBubbleMessage, ChatMessage, FileChange } from "./types";

export interface FileChangeTurn {
  prompt: ChatBubbleMessage;
  changes: FileChange[];
  answer?: string;
}

function keepRichest(changes: Map<string, FileChange>, change: FileChange): void {
  const key = normalizePathKey(change.path);
  const existing = changes.get(key);
  const richness = (value: FileChange): number =>
    4 * Number(typeof value.before === "string") + 4 * Number(typeof value.after === "string") +
    2 * Number(!!(value.removed?.length || value.added?.length)) + Number(value.beforeKnown === true);
  if (!existing || richness(change) >= richness(existing)) changes.set(key, change);
}

/** Manual prompts delimit turns; runtime notices remain inside their owning turn. */
export function groupFileChangeHistory(
  messages: readonly ChatMessage[],
  includeUnchanged = false,
): FileChangeTurn[] {
  const turns: FileChangeTurn[] = [];
  let prompt: ChatBubbleMessage | undefined;
  let rows: ChatMessage[] = [];
  const flush = (): void => {
    if (!prompt) return;
    const changes = new Map<string, FileChange>();
    for (const path of changedFilesFromToolRows(rows, 0)) {
      changes.set(normalizePathKey(path), {
        path,
        before: null,
        after: null,
        beforeKnown: false,
      });
    }
    for (const row of rows) {
      const snapshots =
        row.kind === "file_changes"
          ? row.changes
          : "fileChanges" in row ? row.fileChanges : undefined;
      for (const change of snapshots ?? [])
        keepRichest(changes, change);
    }
    // Tool calls invalidate pre-tool progress; only the last settled answer belongs here.
    let answer: string | undefined;
    for (const row of rows) {
      if (row.kind === "tool_call") answer = undefined;
      if (isBubbleMessage(row) && row.role === "agent" && !row.pending &&
          !row.localOnly && !row.error && !row.isSlashLoader &&
          !isAutoInjectedPrompt(row.content) && row.content.trim()) {
        answer = row.content;
      }
    }
    if (changes.size || includeUnchanged)
      turns.push({ prompt, changes: [...changes.values()], ...(answer ? { answer } : {}) });
  };
  for (const message of messages) {
    if (
      isBubbleMessage(message) &&
      message.role === "user" &&
      !isAutoInjectedPrompt(message.content)
    ) {
      flush();
      prompt = message;
      rows = [];
    } else {
      rows.push(message);
    }
  }
  flush();
  return turns;
}

/** Match repeated prompt texts from the tail, never collapse distinct prompt IDs. */
export function mergeFileChangeHistory(
  stored: readonly ChatMessage[],
  live: readonly ChatMessage[],
): FileChangeTurn[] {
  const turns = groupFileChangeHistory(stored, true);
  const liveTurns = groupFileChangeHistory(live, true);
  const used = new Set<number>();
  const appended: FileChangeTurn[] = [];
  for (let i = liveTurns.length - 1; i >= 0; i--) {
    const turn = liveTurns[i];
    let index = turns.findIndex(
      (candidate, j) => !used.has(j) && candidate.prompt.id === turn.prompt.id,
    );
    if (index < 0) {
      for (let j = turns.length - 1; j >= 0; j--) {
        if (!used.has(j) && turns[j].prompt.content === turn.prompt.content) {
          index = j;
          break;
        }
      }
    }
    if (index < 0) {
      appended.unshift(turn);
      continue;
    }
    used.add(index);
    const changes = new Map(
      turns[index].changes.map((change) => [
        normalizePathKey(change.path),
        change,
      ]),
    );
    for (const change of turn.changes)
      keepRichest(changes, change);
    turns[index] = {
      prompt: turns[index].prompt,
      answer: turn.answer ?? turns[index].answer,
      changes: [...changes.values()],
    };
  }
  return [...turns, ...appended].filter((turn) => turn.changes.length > 0).reverse();
}

export async function loadFileChangeHistory(
  sessionId: string,
): Promise<ChatMessage[]> {
  // Full public history API includes continuation and the latest local snapshot overlay.
  const items: DbHistoryItem[] =
    await window.hermesAPI.getSessionMessages(sessionId);
  const messages = dbItemsToChatMessages(items);
  const prompts = new Map(
    items
      .filter((item) => item.kind === "user")
      .map((item) => [`db-${item.id}`, item.content ?? ""]),
  );
  return messages.map((message) =>
    isBubbleMessage(message) && message.role === "user"
      ? { ...message, content: prompts.get(message.id) ?? message.content }
      : message,
  );
}

/** Resolve navigation only; retain the snapshot path for display/copy/diff. */
export function resolveHistoryExplorerTarget(path: string, cwd?: string): { path: string; folder: string } | null {
  const absolute = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/;
  if (!path || path.includes("\0")) return null;
  const joined = absolute.test(path) ? path : cwd && absolute.test(cwd)
    ? `${cwd.replace(/[\\/]+$/, "")}/${path}` : null;
  if (!joined) return null;
  const normalized = joined.replace(/\\/g, "/");
  const prefix = normalized.match(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/?|\/)/)?.[0];
  if (!prefix) return null;
  const parts: string[] = [];
  for (const part of normalized.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  if (!parts.length) return null;
  const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return { path: root + parts.join("/"), folder: parts.length === 1 ? root : root + parts.slice(0, -1).join("/") };
}
