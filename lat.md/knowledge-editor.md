# Knowledge file editor

The Knowledge page edits files inline with markdown-aware syntax highlighting
via CodeMirror 6 — a real editor, not a highlighting overlay.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx]] mounts an
`EditorView` into `.knowledge-cm-host` with `@codemirror/lang-markdown` (fenced
code blocks use `@codemirror/language-data`) and the `oneDark` theme. The
editor is recreated per file (`selectedFile?.path`/`loading` deps); external
content changes (file switch, save, focus refresh) dispatch a full-doc replace
that preserves the caret. `fileContent` state mirrors the doc via an update
listener, so the existing Save path is unchanged.

## @ mention autocomplete

`@`-mention file search is a CodeMirror autocomplete source, not a custom dropdown.

Typing `@` opens the standard autocomplete popup at the caret; picking a
candidate inserts the path followed by a space. Candidates come from bundles +
custom folders + Everything + recent folders; `findMention` (from the chat
mention module) detects the token and its query.

## Bundle and file management

The bundle sidebar supports creating, renaming, and deleting bundles, plus
moving files between bundles by drag-and-drop.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx#KnowledgeScreen]] renders each bundle as a header row (chevron + name + hover actions: rename pencil, add-file "+", delete) with its file list below. The transient name inputs ("New Bundle" bar and per-bundle "Add File" bar) get `autoFocus` plus a ref-driven `focus()`/`select()` effect keyed on their open state — without it the input appears while the clicked button still holds focus, so the first keystrokes went nowhere ("hardly focus" bug). The inline rename inputs (bundle + file) stop click/mousedown propagation so focusing them never toggles the parent's expand/select handlers, and submit on Enter/blur / cancel on Escape.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx#submitRenameBundle]] renames a bundle through the `rename-knowledge-bundle` IPC ([[src/main/knowledge.ts#renameKnowledgeBundle]] — sanitizes the new name like `createKnowledgeBundle`, renames the directory, and rejects same/invalid names). The bundle's expansion and @-mention enabled states are re-keyed from the old name to the new one, and the open file's `selectedFile` follows the rename (bundle name + path segment rewritten with an escaped regex).

Files move between bundles with HTML5 drag-and-drop: each `.knowledge-file-item` is `draggable` (dimmed while dragged), and each `.knowledge-bundle-item` is a drop target (`onDragOver`/`onDrop` with `application/x-knowledge-file` data) that highlights via `.knowledge-bundle-item--drag-over` while the pointer is over it. Dropping on the source bundle is ignored; otherwise `move-knowledge-file` IPC runs [[src/main/knowledge.ts#moveKnowledgeFile]] — a cross-directory `rename` with a `mkdir` of the target — then the list reloads and an open selection follows the file to its new bundle.
