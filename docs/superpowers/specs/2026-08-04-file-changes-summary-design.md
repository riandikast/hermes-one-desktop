# File-changes summary after assistant responses — Design

Date: 2026-08-04

## Goal

After a completed assistant turn that modified files, show a badge on the
response (e.g. "📝 3 files changed"). Clicking opens a dialog listing each
changed file with a side-by-side before/after view.

## Decisions (from brainstorming)

- **Diff view**: side-by-side Before | After (two read-only CodeMirror panes,
  oneDark theme) with a per-file change summary (X additions, Y deletions, or
  Created / Deleted).
- **Badge scope**: per-turn — every completed assistant message that touched
  files carries its own badge.

## Architecture

All capture happens in the dashboard transport
(`src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts`), where
`tool.start` / `tool.complete` events already stream through (and where the
plan-mode write-tool interceptor already parses tool names + args).

### Capture (during streaming)

- **`tool.start`** for write tools (`write_file`, `edit_file`, `patch_file`,
  `create_file`, `delete_file`, `move_file`, `copy_file`, `rename_file`,
  `apply_patch`, `str_replace`, `save_file`) — extract the target path from
  `payload.args` (try `path`, `file_path`, `file`, `target`, then scan the
  JSON text for a `/`-containing string; skip if unresolvable). Snapshot the
  file **before** via the existing `window.hermesAPI.readFile(path)` (unlimited
  cap; null = file didn't exist).
- **`tool.complete`** for the same callId — read **after** content; store
  `{ path, before, after }` in a per-turn ref list.
- **`message.complete`** — attach the accumulated list to the assistant
  message via a new optional `fileChanges?: FileChange[]` field on
  `ChatBubbleMessage` (types.ts), then clear the turn's accumulator.
- Failures/races: read errors are swallowed (best-effort); a tool.complete
  without a recorded start is skipped; multiple edits to the same path keep
  the first `before` and last `after`.

### Data model

```ts
export interface FileChange {
  path: string;
  before: string | null; // null = created
  after: string | null;  // null = deleted
}
```

### Dialog (`FileChangesDialog.tsx`)

- Modal (reuse `.models-modal`-style overlay pattern): left = file list
  (path, change summary), right = side-by-side Before | After CodeMirror
  read-only panes (oneDark, `editable: false`), scrollable.
- Empty content states: Created (before empty), Deleted (after empty).
- Badge on the assistant bubble (`.chat-file-changes-badge`) — click opens
  the dialog. Rendered in `MessageRow.tsx` from `message.fileChanges`.

## Testing

- Pure helper for path extraction (`extractToolPath(args)` in a small module
  or in dashboardEventAdapter.ts) — unit tests for path keys, JSON-scan
  fallback, unresolvable args.
- `applyDashboardStreamEvent` unchanged (capture is transport-side, not
  adapter-side).
- Manual: run a chat turn that edits a file (dashboard transport), verify
  badge + dialog shows correct before/after; new-file and delete-file cases.

## Out of scope

- Legacy transport capture (progress strings lack reliable paths).
- Interactive diff / apply-changes.
- Persisting diffs to disk or the session DB.
