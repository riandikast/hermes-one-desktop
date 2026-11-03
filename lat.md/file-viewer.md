# File viewer / editor

The chat-side file preview ([[src/renderer/src/screens/Chat/FileViewer.tsx#FileViewer]]) is a real editor, not a read-only viewer.

Text files open in a CodeMirror 6 editor (oneDark theme, `basicSetup` — so
Ctrl+F search, Ctrl+A/C/V, Ctrl+Z history all work) with syntax highlighting
resolved per file extension via `@codemirror/language-data`. Images and binary
files keep their preview/binary messages.

## Tabs

File editors share the top-strip tab model and retain mounted state across tab switches.

The editor opens as a STANDALONE top-strip tab, exactly like a session tab (not a child of the chat page). Each open file is a [[src/renderer/src/screens/Layout/chatRuns.ts#ChatRun]] with `filePath` + `targetView: "file"`, so [[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx#ActiveSessionsBar]] renders it as a chip in the window's top tab strip (file icon instead of profile avatar, hover-revealed close, active merges into the pane) — reusing the app's session-tab system wholesale: switching activates the run, closing aborts it, close-others/close-to-right/reorder all work. Clicking a file in the worktree sidebar ([[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]]) dispatches a `hermes-open-file` window event; [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] listens and opens/activates the file run. The content area renders the `"file"` pane: every open file's [[src/renderer/src/screens/Chat/FileViewer.tsx#FileViewer]] stays MOUNTED (display toggled by the active run), so unsaved edits survive tab switching. Escape closes the active tab (last one returns to chat) unless the CodeMirror search panel is open; only the active tab binds the Escape listener.

## Autosave

Edits write back to disk automatically via the `write-file` IPC, 500 ms after the last keystroke. Ctrl+S always forces an immediate save.

Each editor tab owns its save mode, seeded from the Utils default when the file opens. A toggle at the editor's top right turns auto-save off for that file only; manual mode reveals a Save button, shows Unsaved in the status bar, and keeps the doc in memory until saved. Turning auto-save off cancels a pending debounce and marks the file dirty rather than dropping that write.

Settings → Utils chooses the default for newly opened files (`hermes.fileEditor.autoSave`, default on) using the same segmented control as Window terminal style; already-open editors keep their own value. Regressions: [[src/renderer/src/screens/Chat/FileViewer.autosave.test.tsx]], [[src/renderer/src/components/settings/UtilsPane.test.tsx]].

## Fold gutter

CodeMirror's default fold markers are literal `›`/`⌄` glyphs. The file editor replaces them with masked chevron icons so the gutter matches the app's icon set.
