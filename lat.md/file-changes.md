# File-changes summary

Completed file-edit tools produce a cumulative “N files changed” chip per manual prompt. Clicking it opens the recorded paths and available before/after snapshots.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] captures provisional baselines on `tool.start` and confirms landed paths on `tool.complete`. [[src/renderer/src/screens/Chat/fileChanges.ts#isFileEditTool]] is shared by live capture, structured argument retention, and transcript derivation; bare, dotted and double-underscore namespaced edit tools use the same allowlist.

[[src/renderer/src/screens/Chat/fileChanges.ts#fileEditPaths]] parses JSON tool results and collects every `files_modified` entry before falling back to result/argument paths. Paths in explicit fields preserve spaces and extensionless filenames; relative paths resolve against the session cwd when available. Structured arguments take precedence over friendly tool labels. DB reconciliation repairs incomplete edit arguments/results without changing React IDs, and recovery serialization retains structured arguments. The adapter accepts `tool_name`/`result_text` aliases and preserves path-only metadata when full arguments exceed its size cap. Failed results and command-executor side effects are excluded. Working-tree Git detection remains disabled; unrelated dirty files and build logs are not attributed to the agent.

A landed path stays listed even if snapshots cannot be read, including deleted or unavailable files. Missing content means unavailable diff, not an absent edit. Only successful completions publish provisional baselines, so failed patches do not become false changes.

The latest cumulative snapshots persist via `recordSessionFileChanges` and [[src/main/session-continuation-store.ts#persistSessionFileChanges]] in `desktop_session_file_changes`. [[src/main/sessions.ts#applySessionLocalOverlays]] restores that session-latest overlay. Older prompt chips and the history dialog recover paths from stored tool calls/results; historical full-content snapshots are not a per-prompt archive. The legacy overlay has no owning prompt ID and still attaches to the latest assistant answer; it can therefore be stale after a later no-edit prompt. Correct historical snapshot ownership requires a separate persistence change, not merging unrelated prompts. No schema change or Git initialization is performed.

Capture is dashboard-transport only. Shell edits, nested `execute_code` operations without structured child edit events, and child-agent edits absent from the parent's transcript are not inferred from arbitrary stdout. Snapshot reads remain best-effort.

Regressions: [[src/renderer/src/screens/Chat/fileChanges.test.ts]], [[src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts]], and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]] cover multi-file results, namespaced edits, spaced/extensionless paths, friendly labels, missing snapshots, failed edits and persistence.

## Cumulative prompt footer

Each manual user prompt owns one cumulative summary. Runtime-injected continuations and automatic recovery keep the earliest before-content and latest after-content; a new manual prompt starts a separate summary.

[[src/renderer/src/screens/Chat/fileChangeSummary.ts#updatePromptFileSummary]] reuses the existing chip ID and merges normalized paths without mutating historical snapshots. [[src/renderer/src/screens/Chat/fileChangeSummary.ts#fileSummaryFooters]] moves summaries below their prompt's latest response for display, including legacy assistant overlays and tool-result snapshots; only the active prompt's footer is hidden while generating. Missing chip paths are recovered from each prompt's landed tool results using the same parser as history. Tool-result pairing is linear in transcript size, and history remains available throughout streaming.

The transport retains capture through interim completions and recovery, invalidates stale async finalizers when work resumes, and persists each cumulative update with the existing overlay API. Stream resumption after an interim completion restores loading immediately. Existing persistence remains session-scoped (latest overlay); no DB schema or older history storage changes.

Regressions: [[src/renderer/src/screens/Chat/fileChangeSummary.test.ts]], [[src/renderer/src/screens/Chat/MessageList.fileSummary.test.tsx]], and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]]. They cover continuation, duplicate completions, stale reads, latest-after/earliest-before, new manual prompts, footer ordering/hiding and unchanged history availability.

## Live file-tool preview

Settings → Appearance → Tool calls animation opts into a read-only file pane during active generation. It defaults off and is independent of tool auto-expansion.

[[src/renderer/src/screens/Chat/ToolFilePreview.tsx#ToolFilePreview]] fills the right side of the transcript area above the full-width composer. Floating controls and pins shift beside the preview; the DB badge is anchored inside a positioned transcript column so it cannot overlap the sibling preview. Small windows stack transcript and preview. The editor never writes files or takes keyboard focus. It reuses CodeMirror, syntax grammars and existing fold icons, with active-chat background/text/accent tokens instead of a fixed dark editor theme. The language is resolved from the file extension through `@codemirror/language-data` (`.tsx` and `.jsx` included), and a theme-token palette colors keywords, strings, numbers, types, properties and comments so the preview reads as highlighted code rather than plain text; [[src/renderer/src/screens/Chat/ToolFilePreview.test.tsx]] asserts distinct token classes for a TypeScript file. A single divider replaces the separate rounded card. Summary chips align with the assistant avatar/gap column.

[[src/renderer/src/screens/Chat/toolFilePreviewModel.ts#latestFileTool]] selects explicit read/write/patch calls from the current manual prompt, excluding shell tools. The dashboard adapter preserves bounded structured arguments separately from friendly labels. Local reads are capped at 64 KB; remote sessions never read matching local paths. Missing, binary and truncated reads report payload-only/capped states. Complex context patches show a labeled excerpt rather than pretending to apply a full-file patch.

Typing/deletion is a bounded progressive replay, not actual agent keystrokes. Late baseline reads never restart an active replay; fast patch snapshots already containing the result use the authoritative old/new hunk. Read tools animate an expanding text selection without changing contents or stealing focus. Reduced-motion settles immediately. The pane, editor and timers unmount when generation ends, the preference turns off or the chat becomes inactive; stale reads are discarded. Existing file-history snapshots remain unchanged.

Replay normalizes both input snapshots with CodeMirror's `EditorState.toText` before calculating edits, selections or scroll offsets. Raw CRLF lengths otherwise exceed the normalized document and throw `Selection points outside of document`. The display-only normalization never modifies files or stored snapshots. Regression covers read/edit replay, reduced motion and shorter follow-up contents.

Regressions: [[src/renderer/src/screens/Chat/ToolFilePreview.test.tsx]], [[src/renderer/src/screens/Chat/toolFilePreviewModel.test.ts]], [[src/renderer/src/screens/Chat/ToolFilePreview.wiring.test.ts]], [[src/renderer/src/components/settings/toolCallsAnimation.test.ts]], and [[src/renderer/src/components/settings/AppearancePane.test.tsx]]. Unit tests verify animation, read-only behavior, cleanup, source selection, remote isolation, toggle persistence and layout contracts; they do not prove native Electron geometry.

Replay scrolls to the edit once (reads start at the beginning), then uses CodeMirror's native `nearest` strategy on each frame. Visible cursor movement does not recenter the viewport; offscreen cursors cause only the minimum scroll. Read/edit regression tests assert this policy without claiming live Electron geometry.

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
