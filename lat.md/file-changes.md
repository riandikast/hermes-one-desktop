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

The summary is PERSISTED so it survives reopen: at `message.complete` the
transport calls `recordSessionFileChanges` (preload → main
`persistSessionFileChanges` in [[src/main/session-continuation-store.ts]]),
stored per session in the local `desktop_session_file_changes` table.
[[src/main/sessions.ts#applySessionLocalOverlays]] re-attaches the stored
changes to the LAST assistant `HistoryItem` of the session on load, and
`dbItemsToChatMessages` copies them onto the reopened bubble — same badge,
live or reopened.

Capture is dashboard-transport only — the legacy transport's progress strings
don't carry reliable paths. Reads are best-effort; failures are swallowed.
