# File-changes summary

Completed file-edit tools produce a cumulative “N files changed” chip per manual prompt. Clicking it opens the recorded paths and available before/after snapshots.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] captures provisional baselines on `tool.start` and confirms landed paths on `tool.complete`. [[src/renderer/src/screens/Chat/fileChanges.ts#isFileEditTool]] is shared by live capture, structured argument retention, and transcript derivation; bare, dotted and double-underscore namespaced edit tools use the same allowlist.

[[src/renderer/src/screens/Chat/fileChanges.ts#fileEditPaths]] parses JSON tool results and collects every `files_modified` entry before falling back to result/argument paths. Paths in explicit fields preserve spaces and extensionless filenames; relative paths resolve against the session cwd when available. Structured arguments take precedence over friendly tool labels. DB reconciliation repairs incomplete edit arguments/results without changing React IDs, and recovery serialization retains structured arguments. The adapter accepts `tool_name`/`result_text` aliases and preserves path-only metadata when full arguments exceed its size cap. Failed results and command-executor stdout are excluded from confirmed agent edits. A separate Git-backed workspace comparison captures script-driven changes during the prompt, explicitly labelled as workspace evidence rather than agent attribution.

A landed path stays listed even if snapshots cannot be read, including deleted or unavailable files. Missing content means unavailable diff, not an absent edit. Only successful completions publish provisional baselines, so failed patches do not become false changes.

Snapshots persist via `recordSessionFileChanges(sessionId, changes, userMessageId)` and [[src/main/session-continuation-store.ts#persistSessionFileChanges]] in the additive `desktop_prompt_file_changes` table, keyed by session and canonical user row. Main validates the owner belongs to the session. Updates retain earliest known before/latest after only within that prompt; a later no-edit prompt inherits nothing. [[src/main/sessions.ts#applySessionLocalOverlays]] restores snapshots on their owning user rows, including split backward pages; archive reads are scoped to user IDs on each page. Legacy `desktop_session_file_changes` rows remain untouched but are ignored because ownership cannot be proved. No Git initialization or backend source modification occurs.

Capture is dashboard-transport only. Observed local child spawns use the child-session collector below. Shell edits and nested `execute_code` operations without structured child edit events are not inferred from stdout; snapshot availability remains best-effort. Main/preload changes require a user-controlled desktop rebuild/restart; no installed backend patch is needed.

Regressions: [[src/renderer/src/screens/Chat/fileChanges.test.ts]], [[src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts]], and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]] cover multi-file results, namespaced edits, spaced/extensionless paths, friendly labels, missing snapshots, failed edits and persistence.

## Cumulative prompt footer

Each manual user prompt owns one cumulative summary. Runtime-injected continuations and automatic recovery keep the earliest before-content and latest after-content; a new manual prompt starts a separate summary.

[[src/renderer/src/screens/Chat/fileChangeSummary.ts#updatePromptFileSummary]] reuses the existing chip ID and merges normalized paths without mutating historical snapshots. [[src/renderer/src/screens/Chat/fileChangeSummary.ts#fileSummaryFooters]] moves summaries below their prompt's latest response for display, including legacy assistant overlays and tool-result snapshots; only the active prompt's footer is hidden while generating. Missing chip paths are recovered from each prompt's landed tool results using the same parser as history. Tool-result pairing is linear in transcript size, and history remains available throughout streaming.

The transport retains capture through interim completions and recovery, invalidates stale async finalizers when work resumes, and queues saves until the exact prompt's canonical DB identity arrives. DB identity is retained separately from the React ID during reconciliation. Uncorrelated completion receipts are not used as owners: this gateway's submit contract lacks a client submission ID, so saves wait for canonical history reconciliation rather than risking late-receipt misattribution. Stream resumption after an interim completion restores loading immediately. Archive regressions: [[tests/prompt-file-change-store.test.ts]], [[tests/prompt-file-change-preload.test.ts]] and [[src/renderer/src/screens/Chat/sessionHistory.test.ts]].

Regressions: [[src/renderer/src/screens/Chat/fileChangeSummary.test.ts]], [[src/renderer/src/screens/Chat/MessageList.fileSummary.test.tsx]], and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]]. They cover continuation, duplicate completions, stale reads, latest-after/earliest-before, new manual prompts, footer ordering/hiding and unchanged history availability.

## Child-session edit collection

Local dashboard chats collect real child-session edit results under the manual prompt that spawned each child, independently of the optional live preview.

[[src/renderer/src/screens/Chat/childFileChanges.ts#ChildFileChangeCollector]] observes session-scoped `subagent.start` identities and retains their original prompt owner through later prompts and completion. It reads one backward page of 100 rows per child sequentially per pass, continuing older pages instead of dropping edits outside the tail. Matched canonical edit call/result pairs are sorted chronologically before merging. Completed children retire after two stable passes; disposal rejects late replies. Duplicate progress mirrors (`submirror:`), failed edits, shell/execute_code output and unresolved relative child paths are excluded. Known payload hunks/content remain usable; absent snapshots remain explicitly unknown, without reading the parent's filesystem. Regressions: [[src/renderer/src/screens/Chat/childFileChanges.test.ts]] and [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]].

Use direct `patch` / `write_file` calls for source edits, including delegated agents; reserve `execute_code` for reads/searches/calculations. Nested `execute_code` edit provenance cannot be reconstructed without backend support. This collector requires observing the spawn in the open local chat; it does not infer old ownership from child rosters, recover missed spawns after app closure, or support remote child-history collection. Existing prompt archives remain available after reopening.

The delayed-child transport regression verifies successful prompt submission, stable React identity after canonical DB reconciliation, and original-prompt persistence after a newer no-edit prompt. Model-status mocks must permit submission rather than accidentally testing a failed turn.

## Git workspace fallback

Local chats with an attached Git directory compare working-tree bytes before submission and after completion. Fallback-only entries say “Workspace change”; concurrent manual edits or generated output cannot be attributed to the agent.

[[src/main/workspace-snapshot.ts#captureWorkspaceSnapshot]] serializes read-only, hidden-window Git enumeration and bounded file hashing. Only the attached directory is scanned, including staged, tracked and non-ignored untracked paths. Content fingerprints detect edits to already-dirty files; unchanged dirt is excluded. New/deleted paths are compared against the captured baseline, never HEAD. No Git initialization, index write, staging, commit or backend modification occurs.

Snapshots cap at 5000 enumerated paths, 256 KiB per file and 16 MiB aggregate reads. Sensitive filenames, symlinks/junctions, submodules, unreadable and oversized files are excluded from both sides, never presented as deletions. Enumeration/aggregate failures disable comparison and show a local notice. Binary files retain hashes with unavailable text, not false deleted status. Newly ignored directories are excluded with descendants. Git commands time out after ten seconds and use `windowsHide`.

[[src/renderer/src/screens/Chat/workspaceChanges.ts#workspaceChanges]] compares snapshots. The transport retains one baseline across continuation/recovery, resets for a new manual prompt, rejects stale session/generation replies, and merges paths with direct-edit evidence. Direct evidence wins attribution; fallback provenance survives prompt archives and history. Remote/SSH chats and non-repositories remain direct-tool-only. This cannot reconstruct historical prompts without baselines or observe changes after completion without another completion event.

Regressions: [[src/main/workspace-snapshot.test.ts]], [[src/renderer/src/screens/Chat/workspaceChanges.test.ts]], [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]], [[tests/prompt-file-change-store.test.ts]] and [[src/renderer/src/screens/Chat/FileChangeHistoryDialog.test.tsx]]. Main/preload changes require a user-controlled rebuild/restart. Transport unmount clears delayed completion-sync timers so a prior chat cannot read into a later mount.

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
