# Linked working folder

A conversation can be bound to a working folder (issue #27) — a desktop-only binding that scopes the agent's work. It is sent to the agent per message as a system message, and persisted per session so re-opening a conversation restores its folder.

## Desktop-only persistence

The folder isn't part of hermes-agent's session schema, so it lives in a desktop-owned table in the active profile's `state.db`, keyed by `session_id`.

[[src/main/session-context-folder-store.ts]] holds `desktop_session_context_folders` (mirroring [[src/main/session-continuation-store.ts]]): [[src/main/session-context-folder-store.ts#setSessionContextFolder]] upserts or, for a null folder, deletes the row; [[src/main/session-context-folder-store.ts#getSessionContextFolder]] reads it. The row is dropped with the rest of a session's data in [[src/main/sessions.ts#deleteSessionRows]] so a deleted session leaves no orphan binding.

## Restore and save in the chat

The chat loads the stored folder when resuming a session and saves it whenever it changes, once the conversation has a gateway session id.

In [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] a load effect fetches the folder for `initialSessionId` on mount; a save effect writes `contextFolder` via `setSessionContextFolder` on every change. The save is gated on a "loaded" ref so the initial null can't overwrite a resumed session's stored folder before the load resolves. A brand-new chat saves once its session id resolves after the first message, binding the pre-selected folder to the new session.

## Recent folders dropdown

The context folder picker displays recently used project folders first, allowing quick selection across sessions without opening the OS folder dialog.

[[src/renderer/src/screens/Chat/ContextFolderChip.tsx#ContextFolderChip]] presents a dropdown menu populated by [[src/main/session-context-folder-store.ts#getRecentSessionContextFolders]] via the `list-recent-session-context-folders` IPC channel, combining distinct database folder bindings with cached session paths.

## Resizable tree panel

The context-folder tree panel uses a compact header and can be resized from its left edge, mirroring the in-app browser panel.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] stores its width in `localStorage` under `hermes:worktreePanelWidth`, clamps it between a usable minimum and the available chat width, and updates it through a pointer-drag handle styled by `.worktree-resize-handle`.

## Floating explorer sizing

The chat File explorer uses the shared resizable working dialog and remains open on outside clicks or taps.

The bottom-right handle supports pointer and keyboard resizing without remounting its tree. See [[commands-terminal#Commands store + built-in terminal#Floating working dialogs]]. Standalone tree-panel width behavior is unchanged.

## Large explorer directories

The file explorer paginates each large directory to keep rendered tree rows bounded while retaining access to every entry.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] shows at most 100 immediate children per directory, with previous and next controls for root folders, nested folders and expanded search results. When file history requests a selected child, the explorer opens its page automatically. Live refresh preserves expanded folders and the current page. Directory enumeration and sorting still handle the complete listing.

## Explorer file operations

The file explorer's row menu supports VS Code-style New File, New Folder, Copy, Paste, Rename, and Delete while keeping the existing reveal, terminal, tag, and Source Control actions.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] resolves the owning root for a row and offers mutations only inside it; the root row itself has no rename or delete. Copy mirrors the entry to the OS clipboard (`FileNameW`) and keeps it in memory; Paste is always offered on a folder row, disabled until the panel clipboard or the OS clipboard holds files. Pasting an entry from outside the opened root imports it (this is how files copied in Windows Explorer land in the project), and Ctrl+C / Ctrl+V work on the focused row. Delete asks first, then moves the entry to the OS Recycle Bin, so it stays recoverable.

[[src/main/file-explorer-ops.ts#renameExplorerEntry]], [[src/main/file-explorer-ops.ts#createExplorerEntry]], [[src/main/file-explorer-ops.ts#deleteExplorerEntry]], and [[src/main/file-explorer-ops.ts#copyExplorerEntry]] all re-resolve real paths and reject anything that escapes the opened root, so a symlink or `..` segment cannot widen access. Names reject separators, traversal, Windows-reserved words, and trailing dots/spaces. Paste never overwrites: it appends `copy`, then `copy 2`, and refuses copying a folder into itself. Delete is the only operation routed through `shell.trashItem`.

These are main-process IPC channels (`explorer-rename`, `explorer-create`, `explorer-delete`, `explorer-copy`, `explorer-import`, `explorer-read-clipboard`, `explorer-write-clipboard`), so the packaged app needs a rebuild/restart before the menu works. Regressions: [[tests/file-explorer-ops.test.ts]] (temp-directory rename/create/trash/copy/import, escape, conflict) and [[src/renderer/src/screens/Chat/WorktreePanel.ops.test.tsx]] (prompt flow, internal and OS-clipboard paste, Ctrl+C/V, delete confirmation, root protection).

## SSH remote explorer

Saved SSH hosts appear as extra roots in the file explorer, and they render even when no local folder is attached; the panel opens from the display controls without context folders.

Connections are stored in `explorer-ssh-connections.json` under the app's user-data directory and are created through the "Connect to SSH host" dialog (host, user, port, optional label). The private key is optional and hidden under an "Advanced" disclosure; the password field appears only after the first attempt reports that the host needs one, so key/agent users are never asked for a password up front. Saving runs a real connection probe before the host is shown, so a bad key, password, or host key fails in the dialog instead of as an empty tree. Each host resolves its home directory and uses it as the initial root.

Remote paths are encoded as `ssh://<connectionId>/absolute/path`. [[src/shared/remote-path.ts#parseRemotePath]] and [[src/shared/remote-path.ts#remotePath]] are the only places that encode or decode them. The existing `read-directory`, `read-file`, and `write-file` IPC channels detect that scheme and proxy to [[src/main/ssh-explorer.ts#sshExplorerList]], [[src/main/ssh-explorer.ts#sshExplorerRead]], and [[src/main/ssh-explorer.ts#sshExplorerWrite]], so opening, editing, and autosaving remote files needs no separate editor. The `explorer-rename`, `explorer-create`, `explorer-delete`, and `explorer-copy` channels do the same, scoping every mutation to the host's opened root.

Remote work runs through the `ssh2` client and `python3` on the host. Authentication tries the SSH agent or default keys first; a password is only sent when the host requires it, lives in main-process memory for the current app run, and is never written to disk. Host keys use trust-on-first-use: the first key for a host is appended to `~/.ssh/known_hosts`, and a later mismatch refuses the connection instead of silently trusting it. Listing, reading, writing, and mutations are small Python payloads in [[src/main/ssh-scripts.ts]]; they are the same strings executed over SSH, and are exercised locally against temp directories by [[tests/ssh-scripts.test.ts]]. Delete on a remote host is permanent (there is no Recycle Bin across SSH) and the confirmation says so. Copying between the local machine and a remote host, or between two hosts, is deliberately refused with an explicit message. Local-only actions (reveal in Explorer, terminal) are hidden for remote rows, and the OS clipboard is not written for remote paths.

Regressions: [[src/renderer/src/screens/Chat/WorktreePanel.ops.test.tsx]] (saved host root without folders, remote New File routing) and [[tests/remote-path.test.ts]].

## Composer source control shortcut

The composer provides a Source Control shortcut immediately after the folder picker, targeting the selected base folder.

[[src/renderer/src/screens/Chat/Chat.tsx#Chat]] passes the first context folder to [[src/renderer/src/screens/Chat/SourceControlShortcut.tsx#SourceControlShortcut]], which opens [[src/renderer/src/screens/Chat/SourceControlDialog.tsx#SourceControlDialog]]. The control is disabled without a base folder or for remote connections because the existing Git IPC executes on the local machine.

## Folder index in the system prompt

Session creation seeds a bounded folder index so the model can discover attached workspace files.

Binding a context folder used to only pass it as the gateway cwd — the model had read tools but was never TOLD what the folder contains unless the user wrote an @mention tag. Now the transport builds a folder index via `get-folder-index` IPC ([[src/main/knowledge.ts#buildFolderIndex]] — same shape as the knowledge-bundle index: `## <folder>` sections listing file paths with one-line content hints, skipping vcs/deps dirs, capped at 2000 chars / 40 files per folder) and injects it into the system prompt at session creation alongside [[src/main/knowledge.ts#buildKnowledgeIndex]]. The model learns the attached workspace by default — read the file when a listed path looks relevant. Single-shot limitation shared with the knowledge index: the prompt is fixed at session creation (a folder change mid-session updates the cwd but not the injected index).

## Find in Files (string search)

A Search button in the panel header opens a full-screen dialog that searches file CONTENTS across all context folders — Android-Studio Ctrl+Shift+F style.

[[src/renderer/src/screens/Chat/FindInFilesDialog.tsx#FindInFilesDialog]] debounces the query (250ms, Enter re-searches immediately) and calls the `search-in-files` IPC, backed by [[src/main/file-content-search.ts#searchFileContents]]: a two-phase walk — a fast `readdir`-only pass collects candidate paths (skipping vcs/build dirs, hidden entries, and capping at 4000 scanned files), then files are stat/read/matched with **bounded concurrency (16)** instead of the original sequential one-file-at-a-time reads that made large-repo searches take tens of seconds. Known-binary extensions are skipped without reading, NUL-byte probing catches the rest, files over 2MB are skipped, and a module-scope **search generation** cancels in-flight work the moment a newer query supersedes it (rapid typing no longer queues full walks per stale query). Results cap at 200 files / 200 matches per file. Results group per file (name, path, match count) with expandable 1-based line snippets where the matched text is highlighted. Clicking a match opens the file as a standalone tab AND jumps the CodeMirror editor to that line: the dialog dispatches `hermes-open-file` with `{ path, line }`, [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] stores `fileLine` on the `ChatRun`, and [[src/renderer/src/screens/Chat/FileViewer.tsx#FileViewer]] scrolls the selection to it once the editor mounts (retried after 120ms to cover async language resolution).

## Remote folder picker

Remote and SSH chats use an in-app picker so users do not accidentally select a local macOS folder for a remote session.

[[src/renderer/src/screens/Chat/RemoteFolderPicker.tsx#RemoteFolderPicker]] provides a scrollable folder list, horizontally scrollable breadcrumbs, manual path entry, Escape-to-close, and arrow/Enter keyboard navigation. [[src/main/ipc/register.ts#registerIpcHandlers]] routes `read-directory` to [[src/main/ssh-remote.ts#sshReadDirectory]] for SSH connections and returns no listing for pure Remote Gateway mode until the backend exposes a directory-list endpoint, so the picker still allows typed remote paths.

## Muted tree icons

The tree keeps file-type icon shapes but normalizes their colors so the explorer reads quietly in the chat sidebar.

The `@wesbos/code-icons` SVGs render inside `.worktree-file-icon-wrapper`; CSS overrides inline fills/strokes to `currentColor` while preserving `fill:none` outlines, and folder icons use the same low-opacity white tone.

## Context inheritance on handoff

Seeding a new session with context carries forward the previous session's attached folders and operational state.

When spawning a continued session via [[src/renderer/src/screens/Chat/Chat.tsx#Chat]], `HandoffSessionContext` passes the active context folders, session model override, reasoning effort, on-finish command queue, attached knowledge bundles, and plan mode into [[src/renderer/src/screens/Layout/Layout.tsx#Layout]]. The newly minted [[src/renderer/src/screens/Layout/chatRuns.ts#ChatRun]] receives these initial bindings so continuation chats retain the user's workspace without re-selection.
