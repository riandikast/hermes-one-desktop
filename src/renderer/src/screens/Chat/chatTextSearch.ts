/**
 * In-chat text search: match extraction over the transcript MODEL.
 *
 * Why the model and not the DOM: MessageList mounts only a budgeted tail of
 * the transcript (see forkTranscriptWindow), so a DOM-only search would
 * silently miss matches in collapsed older turns — and the user asked for a
 * search across the whole chat. Matching therefore runs over the message
 * array; the highlight layer in `ChatSearch.tsx` paints the matches that are
 * actually rendered.
 */
import type { ChatMessage } from "./types";

export interface ChatSearchMatch {
  messageId: string;
  /** 0-based occurrence index of this match within its own message. */
  indexInMessage: number;
}

/**
 * The text a transcript row renders, or "" for rows that render no prose.
 * Mirrors what the transcript actually shows: bubbles, reasoning, tool
 * name/args, tool output and clarify questions. Hidden gateway system markers
 * and the file-changes chip are excluded — they are not user-visible text.
 */
export function messageSearchText(message: ChatMessage): string {
  const row = message as unknown as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind : "";
  switch (kind) {
    case "reasoning":
      return typeof row.text === "string" ? row.text : "";
    case "tool_call":
      return [row.name, row.args]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n");
    case "tool_result":
      return typeof row.content === "string" ? row.content : "";
    case "clarify":
      return typeof row.question === "string" ? row.question : "";
    case "file_changes":
      return "";
    default:
      break;
  }
  const content = typeof row.content === "string" ? row.content : "";
  if (content.trimStart().startsWith("[System:")) return "";
  return content;
}

/** Case-insensitive, non-overlapping occurrence count. */
export function countOccurrences(text: string, query: string): number {
  if (!text || !query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/**
 * Every match in transcript order, numbered per message. The raw query is used
 * for matching (a query of spaces legitimately matches spaces); an empty query
 * matches nothing.
 */
export function findChatMatches(
  messages: ReadonlyArray<ChatMessage>,
  query: string,
): ChatSearchMatch[] {
  if (!query) return [];
  const matches: ChatSearchMatch[] = [];
  for (const message of messages) {
    const text = messageSearchText(message);
    if (!text) continue;
    const occurrences = countOccurrences(text, query);
    for (let index = 0; index < occurrences; index++) {
      matches.push({ messageId: message.id, indexInMessage: index });
    }
  }
  return matches;
}

/**
 * Chrome-style wrap-around stepping. `-1` means "no current match" — stepping
 * from there jumps to the first (or last, going backwards) match.
 */
export function stepMatchIndex(
  current: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}
