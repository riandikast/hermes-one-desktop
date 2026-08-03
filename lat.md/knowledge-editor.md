# Knowledge file editor

The Knowledge page edits files inline with syntax highlighting — an overlay
technique that keeps a real `<textarea>` for editing while showing colored
tokens.

[[src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx]] renders a
highlighted `<pre class="knowledge-highlight">` behind the `.knowledge-textarea`.
The textarea's text is transparent (`color: transparent; caret-color:
var(--text-primary)`) so the caret, selection, and `@` mention autocomplete
still behave natively while the tokens show through. Both layers share the
same monospace metrics (13px/1.6, 16px padding, `pre-wrap`), and the textarea's
`scroll` event syncs the overlay's `scrollTop` so they stay aligned.

The highlighter (highlight.js core API + the `lib/common` side-effect bundle,
~36 languages, `highlightAuto`) is lazy-loaded once via `loadHighlighter()`,
mirroring AgentMarkdown's lazy pattern. Content over 200k chars renders
escaped-plain instead of highlighted to keep per-keystroke cost bounded.
