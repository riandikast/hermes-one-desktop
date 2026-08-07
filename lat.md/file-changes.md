# File-changes summary

Assistant turns that modify files show a "N files changed" badge on the
response bubble; clicking opens a dialog with a side-by-side before/after diff.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] captures
per-turn changes live from the tool stream: on `tool.start` of a write tool
(`WRITE_TOOL_NAMES` in the dashboard event adapter), [[src/renderer/src/screens/Chat/fileChanges.ts#extractToolPath]]
pulls the target path from the tool args and the file is snapshotted before;
on `tool.complete` the after-content is read. The accumulated
`{ path, before, after }` list is attached to the assistant message
(`fileChanges` on `ChatBubbleMessage`) at `message.complete`. [[src/renderer/src/screens/Chat/MessageRow.tsx]]
renders the badge; [[src/renderer/src/screens/Chat/FileChangesDialog.tsx]]
shows the list + side-by-side read-only CodeMirror panes.

[[src/renderer/src/screens/Chat/fileChanges.ts#extractToolPath]] also resolves
RELATIVE path keys (`path: "config.yaml"`) against the session cwd
(`lastSyncedCwdRef` / context folder) — many tools invoke write tools with
relative paths, which the old absolute-only matcher silently missed. The
absolute-check regex is anchored (`^/`), so `src/a.js`-style values are no
longer misread as absolute.

The summary is now a dedicated `file_changes` transcript row (a chip that opens the diff dialog) — INDEPENDENT of the answer bubble, so a missing final answer (lost completion) can never swallow the badge; it is emitted at both `message.complete` and the quiet-finalize recovery path. Detection is hybrid, AUTHORITATIVE-FIRST: when the backend ships a unified diff on `tool.complete` (`payload.inline_diff` — the official desktop contract; emitted for `write_file`/`patch`/`skill_manage` by `tui_gateway/server.py`), it wins. [[src/renderer/src/screens/Chat/diffLines.ts]] parses/strips/counts it (`countDiffLineStats` → the `+N −M` chips), and the captured `FileChange.diff` rides the persisted JSON so reopened sessions restore the same diff cards. The per-edit tool row also renders a collapsible Diff card from the adapter-attached `ToolResultMessage.diff`. Without `inline_diff`, the tool-event capture merges with [[src/main/git.ts#getGitWorkingTreeChanges]] — when the workspace is a git repo, `git status --porcelain` + `git show HEAD:` provide the AUTHORITATIVE change list (catches terminal writes and missed tools, with before-content from the HEAD blob); non-repo folders fall back to tool capture only. Git is never initialized on the user's folder (mutating their workspace is bad practice). Terminal-like tools only count a path in the command as a change candidate when the command actually WRITES (`>`/`>>`, `cp`, `mv`, `sed -i`, `touch`, `git add`, …) — a read-only `grep godot.log` no longer registers the game log (which keeps being written) as "edited by the model". Tool capture also reads the payload TOP LEVEL (some gateways put `path`/`old_string`/`new_string` directly on the tool payload, e.g. a bare `Patch` tool with `{mode, path, old_string, new_string}`) and, most authoritatively, the tool's own `files_modified` array — the exact changed paths, no path guessing needed. Files over 2MB are skipped. The summary is PERSISTED so it survives reopen: at `message.complete` the
transport calls `recordSessionFileChanges` (preload → main
`persistSessionFileChanges` in [[src/main/session-continuation-store.ts]]),
stored per session in the local `desktop_session_file_changes` table.
[[src/main/sessions.ts#applySessionLocalOverlays]] re-attaches the stored
changes to the LAST assistant `HistoryItem` of the session on load, and
`dbItemsToChatMessages` copies them onto the reopened bubble — same badge,
live or reopened.

Capture is dashboard-transport only — the legacy transport's progress strings
don't carry reliable paths. Reads are best-effort; failures are swallowed.
