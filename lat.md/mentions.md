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

## Keyboard navigation follows the selection

Arrow keys move the highlight inside a fixed-height picker, so the selected row must stay visible.

The picker (`.mention-menu`, `max-height: 260px`, `overflow-y: auto`) used to only move the highlight: past roughly five rows the selected item — the row Enter inserts — scrolled out of view with no way to see it. [[src/renderer/src/screens/Chat/ChatInput.tsx]] now follows `mentionSelected` with an effect that scrolls `.mention-menu-item-selected` into view through [[src/renderer/src/screens/Chat/mentionScroll.ts#scrollMentionItemIntoView]].

The helper adjusts `scrollTop` by the minimum overflow instead of calling `scrollIntoView()`, so the chat transcript and composer never scroll as a side effect, and it keeps a 6px padding band at both edges. It is a no-op when the row is already visible, so hovering a row or resetting to the first item does not jump the list.

[[src/renderer/src/screens/Chat/mentionScroll.test.ts]] pins the up/down/no-op/padding math, and `ChatInput.test.tsx` renders a 12-row menu with stubbed rects and arrows past the fold asserting the selected row stays inside the box — the same test fails without the effect.
