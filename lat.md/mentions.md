# @-mention citations

@-mentions in the chat composer render with journal-style citation numbers
inline in the textarea and on the chip badges above it.

[[src/renderer/src/screens/Chat/mention.ts]] encodes each mention as a PUA
sentinel trio in the raw input. `citationMarker(index)` produces `[n]` (1-based
per tag position), `displayText` renders `[n]` where the tag sits, and
`displayToRawPos`/`rawToDisplayPos` walk display space using each marker's
variable length (so `[12]` maps correctly). Numbers are derived from tag
position — removing a tag renumbers the rest. [[src/renderer/src/screens/Chat/ChatInput.tsx]]
shows the same index on each `.chat-mention-tag` chip. `expandTags` still
replaces tags with their paths on send — numbers never reach the model, and
paperclip attachments are unaffected.
