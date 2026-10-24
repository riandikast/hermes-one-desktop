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

## Creating bundles

Creation opens the API-returned canonical bundle name after refreshing the list, clears the previous file selection, and shows an empty file list with Add File. Failed creation keeps the typed name and displays an inline alert for retry.

The mounted regression in [[src/renderer/src/screens/Knowledge/KnowledgeScreen.drill.test.tsx]] covers names containing spaces/punctuation, creation from the bundle list and editor, back navigation, and rejection followed by retry. Creation returns a bundle object, not a boolean.

## @ mention autocomplete

`@`-mention file search is a CodeMirror autocomplete source, not a custom dropdown.

Typing `@` opens the standard autocomplete popup at the caret; picking a
candidate inserts the path followed by a space. Candidates come from bundles +
custom folders + Everything + recent folders; `findMention` (from the chat
mention module) detects the token and its query.

## Bundle and file management

Knowledge uses one full-width surface: bundles, a bundle's files, then the editor. Back returns one level at a time; create, import, rename, delete, copy-path and drag handlers retain their existing APIs.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx#KnowledgeScreen]] renders semantic lists with shared compact rows. Icons identify bundles/files without decorative discs; names and real counts/sizes align on one line. A single bordered list replaces individually elevated tiles, removing the Open pill and centered 900px limit. Existing theme colors and typography preserve the app identity; accent is reserved for focus/drop targets. Direction: ENERGY 1 / RHYTHM 1 / MOTION 1.

Transient New Bundle and Add File inputs retain ref-driven focus/select. Bundle rename re-keys the open bundle and mention states; selected file paths follow rename. File rows retain HTML5 drag data; bundle list items retain drop-target highlighting and move handling.

## List row controls

Native open buttons and sibling action buttons keep navigation separate from management. Bundle and file lists use the same row styles, visible actions, truncated names and responsive metadata; narrow/touch layouts provide 44px action targets.

Add File lives at the top right of the opened bundle's file-list header, not in parent bundle rows. The same header action works for empty bundles; right-click creation remains available.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx]] checks semantic lists, sibling controls, actual counts, file opening and independent Add File input focus. [[src/renderer/src/screens/Knowledge/KnowledgeScreen.drill.test.tsx]] covers creation, rejection/retry, empty states and the navigation round trip.

## Keyboard rename isolation

Rename inputs replace the open button instead of nesting inside it. Enter submits, Escape cancels, and Space remains input text; neither bundle nor file rename navigates or reads a file.

The parameterized regression in [[src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx]] asserts input focus, noninteractive ancestry, submitted API arguments, cancellation and unchanged navigation state for both kinds of row.
