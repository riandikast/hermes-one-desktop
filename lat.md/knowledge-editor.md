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
