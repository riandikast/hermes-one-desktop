# File viewer / editor

The chat-side file preview ([[src/renderer/src/screens/Chat/FileViewer.tsx#FileViewer]]) is a real editor, not a read-only viewer.

Text files open in a CodeMirror 6 editor (oneDark theme, `basicSetup` — so
Ctrl+F search, Ctrl+A/C/V, Ctrl+Z history all work) with syntax highlighting
resolved per file extension via `@codemirror/language-data`. Images and binary
files keep their preview/binary messages.

## Autosave

Edits write back to disk automatically via the `write-file` IPC, 500ms after the last keystroke.

[[src/main/ipc/register.ts]] writes the debounced doc; a header indicator
shows Saving… / Saved / Save failed. Ctrl+S forces an immediate save. Escape
closes the viewer unless the CodeMirror search panel is open (the panel's own
Escape closes it first).
