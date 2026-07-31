# Multi-Root Workspace + Mention Badges Design

Date: 2026-07-31
Status: Approved (user confirmed: all folders in agent context; flat ranked search list)

## 1. Mention tags as removable badges

- Keep the raw `input` string with sentinel tags (`MENTION_START name MENTION_SEP path MENTION_END`) — send, parse, backspace logic unchanged.
- Add pure helpers to `src/renderer/src/screens/Chat/mention.ts`:
  - `displayText(raw: string): string` — collapses each tag's inner text to the invisible sentinel trio, so the textarea shows no tag text.
  - `displayToRaw(raw: string, displayPos: number): number` — maps caret positions from display space to raw space.
- ChatInput: textarea binds the display value; every `selectionStart` read converts display→raw; `insertMention` writes into raw and recomputes display. Chip row above the textarea (attachment-strip pattern): one chip per `parseTags(input)` entry, icon (file/folder), truncated name, X button (removes the tag — same as backspace whole-tag delete), `title` = full path for hover.
- New unit tests for the mapping functions (TDD).

## 2. Multiple context folders

- Main process (`src/main/session-context-folder-store.ts`): new table `desktop_session_context_folder_roots(session_id TEXT, folder_path TEXT, position INTEGER, updated_at REAL)` with `PRIMARY KEY (session_id, folder_path)`. Lazy migration: when reading a session with no rows in the new table, copy the legacy single `desktop_session_context_folders` value in.
- API becomes array-based: `getSessionContextFolders(sessionId): string[]`, `setSessionContextFolders(sessionId, paths: string[])`.
- `session-cache.ts`: `contextFolder: string | null` → `contextFolders: string[]`; update consumers (SidebarRecentSessions, dashboard sync).
- IPC (register.ts): `get-session-context-folder` returns `string[]`; `set-session-context-folder` accepts `string[]`. `select-folder` gains multi-select (`properties: ["openDirectory", "multiSelections"]`).
- Renderer:
  - `Chat.tsx`: `contextFolder` state → `contextFolders: string[]`; persist via `setSessionContextFolders`; dispatch `hermes-session-context-folder-changed` with the array.
  - `ContextFolderChip.tsx`: multi-add flow — dialog multi-select appends; recent-folders dropdown appends; one chip per root, each with its own X.
  - `send-message`: carries `contextFolders`; `contextFolderSystemMessage` lists all roots; `cwd` = first root.
  - `WorktreePanel.tsx`: prop `folderPaths: string[]`; renders one root header per folder (name, collapse chevron — root headers are now collapsible —, terminal button); each root expands into the existing recursive tree; each root watched (`watch-context-folder` per root); refresh events bump `refreshVersion`.
  - `loadMentionEntries`: walk all roots via `listFilesRecursive` (combined cap 10k), merge; `rankMentions` already dedupes/ranks; entry `key` is the absolute path so cross-root name collisions are fine.
- `send-message` context: all roots listed (user-approved).

## 3. Folder right-click menu (sidebar)

- `TreeItem` (WorktreePanel): `onContextMenu` on directory rows → custom small menu (renderer-styled, pattern of mention menu):
  - "Open in Explorer" → new IPC `reveal-in-explorer` (main: `shell.openPath(dir)` for dirs; `shell.showItemInFolder` for files).
  - "Open in Terminal" → existing `open-terminal` with the directory path.
- Menu closes on outside click / Escape.

## 4. Sidebar search

- Search input at top of WorktreePanel (icon + placeholder). 200 ms debounce.
- Query empty → normal multi-root tree.
- Query non-empty → for each root call `listFilesRecursive`, combine, filter+rank with `rankMentions(query, entries, folderOnly=false)` (reused from mention.ts), render flat ranked list (top 50): file icon + `truncatePath`, `title` = full path, click → existing `FileViewer`.
- Files only in search results (folders collapsed into paths).

## 5. Terminal launch delay fix

`src/main/terminal-launcher.ts`:

- Static existence checks first, synchronous, no subprocess: `%ProgramFiles%\PowerShell\7\pwsh.exe`, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (always present → instant fallback).
- Appx probes (`queryWindowsPackageInstallLocations`): run **in parallel**, timeout 1500 ms, and cache results **including failures** so a cold probe never runs twice.
- Pre-warm at app ready: fire-and-forget `resolveTerminalCommandAsync()` so the first user click usually hits the cache.
- `openTerminalInDirectory`: if the cache is cold, spawn the static fallback immediately (zero visible delay) and let the background probe fill the cache for the next click.

## Testing

- New: mention mapping functions (`displayText`, `displayToRaw`), store array round-trip + migration, (terminal resolver if a test seam exists).
- Existing suites must stay green (Chat 227, mention 30).
- Verify manually: build, run, multi-root select, badges, context menu, search, terminal timing.

## Out of scope

- contentEditable rewrite of the textarea.
- Persistent tree expansion state across sessions.
- Remote/SSH multi-root handling (kept at current single-folder behavior; listFilesRecursive already returns null → top-level fallback per root).
