import type { Attachment } from "./attachments";

/**
 * One row of stored history as the main process returns it.
 *
 * Mirrors `src/main/sessions.ts:HistoryItem` (kept structural here so the
 * renderer never imports main-process types).
 */
export interface SessionHistoryRow {
  kind: "user" | "assistant" | "reasoning" | "tool_call" | "tool_result";
  id: number;
  content?: string;
  error?: string;
  text?: string;
  callId?: string;
  name?: string;
  args?: string;
  timestamp?: number;
  attachments?: Attachment[];
  fileChanges?: unknown;
}

/**
 * A backward page of history for a long session.
 *
 * `hasMore` is true when at least one older row exists, so the transcript can
 * offer "Show earlier" without guessing. `oldestId` is the cursor to pass as
 * `beforeId` for the next page (null for an empty page).
 */
export interface SessionHistoryPage {
  items: SessionHistoryRow[];
  hasMore: boolean;
  oldestId: number | null;
  /**
   * Highest row id in this page. The transcript's incremental refresh reads
   * only rows newer than what it already merged, so opening on a page must seed
   * that cursor — otherwise the first poll re-reads the whole session and the
   * paging win is lost.
   */
  newestId: number | null;
}
