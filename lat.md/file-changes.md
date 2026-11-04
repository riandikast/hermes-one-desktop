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

The summary is a dedicated `file_changes` transcript row, independent of the answer bubble. Both `message.complete` and quiet-finalize upsert the same manual prompt summary rather than freezing the first interim snapshot. Detection is hybrid and TURN-SCOPED: the tool-event capture merges with [[src/main/git.ts#getGitWorkingTreeChanges]], but git is only authoritative for what CHANGED DURING THE TURN — the transport snapshots the working tree at send time (`gitSnapshotRef`, keyed by `status|content` via [[src/renderer/src/screens/Chat/fileChanges.ts#gitSnapshotKey]]) and at finalize [[src/renderer/src/screens/Chat/fileChanges.ts#gitChangedDuringTurn]] excludes every entry identical to the snapshot. So files that were already dirty BEFORE the turn (pre-existing edits, line-ending churn) or only READ never appear as "changed by the agent" — `git status --porcelain` alone lists the whole dirty tree and falsely attributed them. Git is never initialized on the user's folder (mutating their workspace is bad practice). Terminal-like tools only count a path in the command as a change candidate when the command actually WRITES (`>`/`>>`, `cp`, `mv`, `sed -i`, `touch`, `git add`, …) — a read-only `grep godot.log` no longer registers the game log (which keeps being written) as "edited by the model". Tool capture also reads the payload TOP LEVEL (some gateways put `path`/`old_string`/`new_string` directly on the tool payload, e.g. a bare `Patch` tool with `{mode, path, old_string, new_string}`) and, most authoritatively, the tool's own `files_modified` array — the exact changed paths, no path guessing needed. Files over 2MB are skipped. The summary is PERSISTED so it survives reopen: at `message.complete` the
transport calls `recordSessionFileChanges` (preload → main
`persistSessionFileChanges` in [[src/main/session-continuation-store.ts]]),
stored per session in the local `desktop_session_file_changes` table.
[[src/main/sessions.ts#applySessionLocalOverlays]] re-attaches the stored
changes to the LAST assistant `HistoryItem` of the session on load, and
`dbItemsToChatMessages` copies them onto the reopened bubble — same badge,
live or reopened.

Capture is dashboard-transport only — the legacy transport's progress strings
don't carry reliable paths. Reads are best-effort; failures are swallowed.

## Cumulative prompt footer

Each manual user prompt owns one cumulative summary. Runtime-injected continuations and automatic recovery keep the earliest before-content and latest after-content; a new manual prompt starts a separate summary.

[[src/renderer/src/screens/Chat/fileChangeSummary.ts#updatePromptFileSummary]] reuses the existing chip ID and merges normalized paths without mutating historical snapshots. [[src/renderer/src/screens/Chat/fileChangeSummary.ts#fileSummaryFooters]] moves summaries below their prompt's latest response for display, including legacy assistant overlays; only the active prompt's footer is hidden while generating. Tool-result snapshots remain available to the file-history dialog throughout streaming.

The transport retains capture through interim completions and recovery, invalidates stale async finalizers when work resumes, and persists each cumulative update with the existing overlay API. Stream resumption after an interim completion restores loading immediately. Existing persistence remains session-scoped (latest overlay); no DB schema or older history storage changes.

Regressions: [[src/renderer/src/screens/Chat/fileChangeSummary.test.ts]], [[src/renderer/src/screens/Chat/MessageList.fileSummary.test.tsx]], and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]]. They cover continuation, duplicate completions, stale reads, latest-after/earliest-before, new manual prompts, footer ordering/hiding and unchanged history availability.

## Live file-tool preview

Settings → Appearance → Tool calls animation opts into a read-only file pane during active generation. It defaults off and is independent of tool auto-expansion.

[[src/renderer/src/screens/Chat/ToolFilePreview.tsx#ToolFilePreview]] fills the right side of the transcript area above the full-width composer. Floating controls and pins shift beside the preview; the DB badge is anchored inside a positioned transcript column so it cannot overlap the sibling preview. Small windows stack transcript and preview. The editor never writes files or takes keyboard focus. It reuses CodeMirror, syntax grammars and existing fold icons, with active-chat background/text/accent tokens instead of a fixed dark editor theme. A single divider replaces the separate rounded card. Summary chips align with the assistant avatar/gap column.

[[src/renderer/src/screens/Chat/toolFilePreviewModel.ts#latestFileTool]] selects explicit read/write/patch calls from the current manual prompt, excluding shell tools. The dashboard adapter preserves bounded structured arguments separately from friendly labels. Local reads are capped at 64 KB; remote sessions never read matching local paths. Missing, binary and truncated reads report payload-only/capped states. Complex context patches show a labeled excerpt rather than pretending to apply a full-file patch.

Typing/deletion is a bounded progressive replay, not actual agent keystrokes. Late baseline reads never restart an active replay; fast patch snapshots already containing the result use the authoritative old/new hunk. Read tools animate an expanding text selection without changing contents or stealing focus. Reduced-motion settles immediately. The pane, editor and timers unmount when generation ends, the preference turns off or the chat becomes inactive; stale reads are discarded. Existing file-history snapshots remain unchanged.

Regressions: [[src/renderer/src/screens/Chat/ToolFilePreview.test.tsx]], [[src/renderer/src/screens/Chat/toolFilePreviewModel.test.ts]], [[src/renderer/src/screens/Chat/ToolFilePreview.wiring.test.ts]], [[src/renderer/src/components/settings/toolCallsAnimation.test.ts]], and [[src/renderer/src/components/settings/AppearancePane.test.tsx]]. Unit tests verify animation, read-only behavior, cleanup, source selection, remote isolation, toggle persistence and layout contracts; they do not prove native Electron geometry.

## Agent and file tabs

One read-only editor serves the main agent and live children. Tabs retain the latest operation per file; selecting a tab pins the choice, and only that file is read and animated.

[[src/renderer/src/screens/Chat/useFilePreviewAgents.ts#useFilePreviewAgents]] reads at most eight child-session tails sequentially (60 rows each, two-second refresh after the previous batch). It never resumes a runtime, starts agents, fetches full history or polls hidden/disabled previews. Session keys and cleanup reject stale replies. Relative child paths remain payload-only rather than assuming the parent's cwd.

[[src/renderer/src/screens/Chat/toolFilePreviewModel.ts#previewFiles]] retains at most twelve files per agent, deduplicates normalized paths and infers completed calls from stored results. [[src/renderer/src/screens/Chat/ToolFilePreview.tsx#ToolFilePreview]] shows status-only waiting children and a single selected editor, with arrow/Home/End tab navigation. [[src/renderer/src/screens/Chat/ToolFilePreview.test.tsx]] verifies four-agent selection without mounting or reading inactive editors; [[src/renderer/src/screens/Chat/useFilePreviewAgents.test.ts]] covers bounded sequential reads and stale-session isolation.

## Per-prompt model answer

Prompt, Model answer, and Files use matching collapsed disclosures; open sections keep their height as the detail pane scrolls.

Markdown renders only when opened, missing answers show a fallback note, and file actions remain unchanged.

## Side-by-side prompt history

The viewport-sized history dialog keeps prompts in a selectable left pane and shows the selected turn's files and answer on the right; narrow windows stack both panes.

[[src/renderer/src/screens/Chat/FileChangeHistoryDialog.tsx#FileChangeHistoryDialog]] uses a semantic navigation list and selected-turn region, while [[src/renderer/src/assets/main.css]] provides the responsive split layout. [[src/renderer/src/screens/Chat/FileChangeHistoryDialog.test.tsx]] covers selection, file actions and theme-aware responsive styling.

[[src/renderer/src/screens/Chat/fileChangeHistory.ts#groupFileChangeHistory]] selects the last settled assistant bubble after the last tool call, excluding reasoning, tool output, pending text, slash loaders, local errors and injected notices. Internal user continuations do not split manual turns. [[src/renderer/src/screens/Chat/fileChangeHistory.ts#mergeFileChangeHistory]] prefers finalized live answers while retaining stored answers for incomplete live tails, even when the live tail has no file snapshots. Repeated prompts remain distinct. [[src/renderer/src/screens/Chat/FileChangeHistoryDialog.test.tsx]] covers two stored turns, lazy Markdown disclosure and live finalization without tools or reasoning.

## Copy current file content

The history dialog's Copy content action reads the entire current local file, not its stored diff. It strips leading U+FEFF BOM characters from clipboard text while preserving whitespace, newlines, embedded U+FEFF and empty files.

[[src/renderer/src/screens/Chat/FileChangeHistoryDialog.tsx#FileChangeHistoryDialog]] resolves relative paths against the session working folder and requests an uncapped `readFile` using `Number.MAX_SAFE_INTEGER`. Pending copies disable content buttons and report progress through the existing status region. Missing/unreadable files, truncated reads, binary controls or replacement characters, and clipboard errors report explicit feedback without a diff fallback. Remote/SSH mode reports unavailable because the existing `read-file` IPC only reads local files; it never falls back to a matching local path. The button reuses themed 44px history actions beside Copy path; narrow layouts retain three action columns.

[[src/renderer/src/screens/Chat/FileChangeHistoryDialog.test.tsx]] exercises the actual button with deterministic whole-file/empty fixtures, single/repeated leading BOM removal, embedded U+FEFF preservation, pending feedback, path resolution, read/clipboard errors, truncation, binary data, and remote refusal.

## Prompt display and themed surfaces

History displays only the user's original prompt, never the serialized Knowledge envelope or its reference index. Its trigger sits after Source Control in the composer, and its dialog fills the viewport for more workspace.

[[src/renderer/src/screens/Chat/fileChangeHistory.ts#loadFileChangeHistory]] applies [[src/shared/knowledge-envelope.ts#originalKnowledgePrompt]] when restoring raw database prompt text; [[src/renderer/src/screens/Chat/fileChangeHistory.ts#groupFileChangeHistory]] also decodes live prompts before merging, since the live turn may arrive before DB refresh. [[src/renderer/src/screens/Chat/chatWiring.test.ts]] guards the theme-token palette for Jump to present and the embedded web-preview tab strip. [[src/renderer/src/screens/Chat/FileChangeHistoryDialog.test.tsx]] guards viewport-sized themed dialog layout.
