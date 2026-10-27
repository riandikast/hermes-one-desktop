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

## Modification timestamps

The picker and selected file/folder tags show filesystem modification time in local time as `21:00, 12 Jan 2026`. Missing or unreadable metadata is omitted; timestamps never enter the prompt.

[[src/renderer/src/screens/Chat/MentionModifiedTime.tsx#MentionModifiedTime]] fetches metadata only for displayed paths via `get-path-modified-time` IPC. Remote/SSH connections return no local metadata. Folder dates are the directory’s own modification time, not a recursive newest-child scan.

[[src/renderer/src/screens/Chat/MentionModifiedTime.test.tsx]] verifies formatting, file/folder tags, unavailable metadata, request failure and stale-request cleanup.
