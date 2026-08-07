# Adopt Official Streaming + File-Edit Tracking

Date: 2026-08-07

## Goal

Adopt the official Hermes desktop's two proven mechanisms while keeping our own chat
box, status strip, interrupt, scroll, and transcript chrome:

1. **Stable message streaming** — live text deltas rendered while pending, with the
   official "authoritative final replaces streamed" stability contract at completion.
2. **File-edit tracking** — per-edit `+N −M` diff cards fed by the backend's
   `inline_diff` on `tool.complete`, plus a per-turn "N files changed" row; diffs
   persisted across reopen. Git working-tree detection stays as a fallback.

## Context (verified against the installed backend + official desktop source)

- Our fork talks to the same backend the official desktop uses (`hermes dashboard`,
  spawned in src/main/dashboard.ts). The backend already emits
  `payload["inline_diff"]` (unified-diff text, optionally prefixed with a
  `┊ review diff` marker line) on `tool.complete` for file-edit tools (`write_file`,
  `patch`, `skill_manage`) — `tui_gateway/server.py:5189-5233`. We currently ignore it.
- Official streaming model (apps/desktop/src/app/session/hooks/use-message-stream/):
  deltas accumulate into a per-session queue flushed on a 33ms adaptive timer; the
  stream bubble is identified by a monotonic `streamId`; at `message.complete`,
  `mergeFinalAssistantText` **discards every streamed text part** and appends ONE
  authoritative final part (deduping reasoning fully covered by the final); a
  `session.info running:false` event un-pends stranded bubbles; optional REST hydrate
  covers incomplete-looking streams.
- Official file model (apps/desktop/src/components/assistant-ui/tool/fallback-model/):
  `inline_diff` is an opaque string; `countDiffLineStats` counts `+`/`-` lines (minus
  `+++`/`---` headers); `isFileEditTool` = patch/write_file/edit_file; path resolved
  from args/result then scraped from the diff. Diff persisted inside the stored tool
  result for rehydration.
- Our transcript is a flat `ChatMessage[]` union (bubble/reasoning/tool/file_changes
  rows) rendered by MessageList with a stable-history cache — we adopt the official
  *stability contract*, not their part-based message model.

## Decisions (user-approved)

1. Adopt BOTH official methods (streaming + file tracker).
2. Full live streaming: `message.delta` renders live while pending; at completion the
   official replace-with-final merge applies. The answer-gate/reveal machinery
   (`useReasoningGate`, `reasoningStall` force-reveal) is removed.
3. Keep our proven fallbacks beneath the official settle path: stall watchdog (120s,
   `hasUnresolvedTool`), quiet-finalize (10s DB catch-up with dbCaughtUp guard).
4. Diffs persist across reopen (extend the existing `desktop_session_file_changes`
   table with a `diff` column) — better than official's mostly-in-memory behavior.
5. UI: port the official unified-diff parser (`parseDiff`/`parseHunks`,
   `countDiffLineStats`) and render diffs inside our existing
   FileChangesDialog-style viewer; per-edit cards live in the tool row. No new UI
   framework, no official card restyling of our tool rows.
6. Keep git fallback: `getGitWorkingTreeChanges` + the write-indicator heuristic stay
   as fallbacks for mutating tools that emit no `inline_diff` (e.g. terminal-driven
   edits); `inline_diff` is authoritative when present.

## Architecture

### 1. Streaming (renderer)

**`src/renderer/src/screens/Chat/dashboardEventAdapter.ts`**
- Flip the `renderAssistantDeltas` default to streaming: `message.delta` appends into
  the pending assistant bubble via the existing `appendAssistantDelta` (already merges
  into the last bubble and handles interleaving with reasoning/tool rows).
- Add `mergeFinalAssistantText(messages, turnStartIdx, finalText)`:
  - Locate the turn's streamed assistant bubble(s) (tracked by the transport's
    `activeTurn`/turnId or the last assistant row before the final).
  - Remove every text bubble whose content is a prefix of the final (lossy/redundant
    streamed text) and any reasoning row fully covered by the final.
  - Append one authoritative assistant bubble with `content: finalText`,
    `pending: false`.
- `message.complete` handler uses the final merge instead of the current
  `completeAssistantWithFinalText` reconciliation (drop `lossyText` recovery).
- Add `finalizeInterruptedMessages(messages, { now })`: on `session.info` with
  `running:false`, un-pend any stranded pending assistant bubble (drop empty
  placeholders, keep non-empty text).

**`src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts`**
- Pass `renderAssistantDeltas: true` (remove the option; always stream).
- Track the turn's streamed bubble ids in `activeTurnRef`-adjacent state so
  `message.complete` knows exactly which rows to replace.
- `session.info` handler: when `running:false` and the turn still has a pending
  bubble, run `finalizeInterruptedMessages` (keep quiet-finalize + watchdog intact).
- Remove the `[gate-diag]`/force-reveal wiring (`reasoningStall`,
  `REASONING_FORCE_REVEAL_MS`); keep `[loading-diag]`, `[quiet-finalize]`,
  `[file-changes]` diagnostics.

**`src/renderer/src/screens/Chat/useReasoningGate.ts` + `reasoningStall.ts`**
- Delete both files (the gate no longer gates the answer; the official settle path
  replaces force-reveal). `Chat.tsx` stops calling `forceReleaseAllReasoning` /
  `resetReasoningGate`.

**Rendering**
- Pending assistant bubbles render markdown live (already the case for streamed
  content). Add a subtle `.chat-bubble--streaming` style (cursor/typing affordance)
  while `pending:true`; the existing ChatTurnStatus strip keeps showing
  "Working…/Running <tool>".
- Auto-scroll: unchanged (macrotask snap already handles per-delta growth).

### 2. File-edit tracking (renderer + main persistence)

**Diff primitives — new `src/renderer/src/screens/Chat/diffLines.ts`** (ported from
official `components/chat/diff-lines.tsx`):
- `parseHunks(diff): DiffHunk[]` — split `@@ -a,b +c,d @@` hunks.
- `parseDiff(diff): DiffLine[]` — lines with `kind: add|remove|context`.
- `countDiffLineStats(diff): { added, removed }` — `+`/`-` lines minus headers.
- `stripDiffChrome(diff)` — strip ANSI codes + leading `┊ review diff` marker line.
- `filePathFromInlineDiff(diff)` — scrape `--- a/<path>` / `+++ b/<path>` / Hermes'
  `a/<path> → b/<path>` arrow line.
- Unit tests for all five.

**Capture — `useDashboardChatTransport.ts`**
- On `tool.complete` with a non-empty `payload.inline_diff`:
  - `toolDiffsRef.current.set(toolCallId, stripDiffChrome(inline_diff))`.
  - Attach `diff` + `added`/`removed` to the turn's file-change accumulator
    (reuse the existing pendingFileChanges flow; `inline_diff` wins over the
    heuristics when both exist for the same path).
- Keep the existing fallback capture (`files_modified`, top-level path,
  write-indicator) only for tools with no `inline_diff`.

**Tool row cards — `MessageRow.tsx` / `HistoryRow.tsx`**
- `ToolResultMessage` gains optional `diff?: string; added?: number; removed?: number`.
- A tool result row with `diff` renders an expandable diff block (ported
  `parseDiff` + our existing diff styling) with a `+N −M` chip in the header row;
  default collapsed (expanded on click). No change to the row chrome otherwise.

**Per-turn row — replace `FileChangesMessage` chip**
- The per-turn summary row becomes "N files changed" derived from the turn's captured
  edits (path, `+A −B` from `countDiffLineStats`), keeping the existing
  `FileChangesRow` click → dialog behavior (dialog now shows unified diff lines
  instead of / in addition to before-after).
- `FileChange` (types.ts) gains `diff?: string`.

**Persistence — main process**
- `src/main/session-continuation-store.ts`: `StoredFileChange` gains `diff?: string`;
  the `desktop_session_file_changes` table gains a `diff` column (migration:
  `ALTER TABLE ... ADD COLUMN diff TEXT` guarded by a pragma table-info check).
- `recordSessionFileChanges` accepts the diff; `attachSessionFileChanges` restores it
  onto the reopened transcript so cards + diffs survive reload.

**Git fallback (kept)**
- `getGitWorkingTreeChanges` (src/main/git.ts) stays as-is, used only when a turn has
  a mutating tool with no captured `inline_diff`. The transport prefers captured
  diffs and fills gaps from git.

### 3. Cleanup

- Remove `renderAssistantDeltas` from `ApplyDashboardEventOptions`.
- Remove `lossyText.ts` (final-merge replaces lossy re-assembly) and its tests.
- Remove `useReasoningGate.ts`, `reasoningStall.ts` and their tests; remove
  `REASONING_FORCE_REVEAL_MS` references.
- Keep: quiet-finalize, stall watchdog, `[loading-diag]`, ChatTurnStatus, interrupt
  confirm, nav arrows, macrotask scroll snap, stable-history cache.

## Error handling

- Missing `message.complete` (crash/gap): `session.info running:false` un-pends;
  quiet-finalize (10s) still covers the DB; stall watchdog still guards 120s tools.
- Provider `error` event mid-stream: keep partial streamed text (official keeps
  `failure.partial`), stamp `error` on the bubble, `pending:false`.
- `inline_diff` absent for a mutating tool: fall back to git detection + heuristics.
- Malformed `inline_diff` (no hunks): `countDiffLineStats` returns 0/0, diff block
  hidden, chip shows "changed" without counts.

## Testing

- New unit tests: `diffLines.test.ts` (parse/count/strip/path), adapter tests for
  `mergeFinalAssistantText` (streamed-then-final, covered-reasoning dedupe, no-final
  case), `finalizeInterruptedMessages` (un-pend, empty-drop), transport tests for
  `inline_diff` capture + fallback precedence, session-continuation-store migration
  test (adds `diff` column idempotently).
- Update existing tests: dashboardEventAdapter (delta rendering path),
  useDashboardChatTransport (remove force-reveal assertions), file-changes tests
  (chip → N-files-changed row), lossyText tests deleted.
- Renderer tests: MessageRow diff card expand/collapse, chip counts.
- Manual: stream a chat turn (text visible live, final replaces cleanly), edit a
  file via patch (card with +N −M, diff opens), reopen the session (cards + diffs
  intact), terminal-driven edit without inline_diff (git fallback chip), minimize
  during streaming (timer flush keeps text arriving).

## Out of scope

- Official part-based message model / assistant-ui runtime (we keep our flat rows).
- Delta flush queue at 33ms (our adapter applies per-event; the macrotask scroll snap
  already bounds commit cost — add coalescing only if profiling shows jank).
- Official review pane / right-rail diff tabs.
- Interim sealed bubbles for tool narration ("Let me check…").
