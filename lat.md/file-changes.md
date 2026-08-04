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

Capture is dashboard-transport only — the legacy transport's progress strings
don't carry reliable paths. Reads are best-effort; failures are swallowed.
