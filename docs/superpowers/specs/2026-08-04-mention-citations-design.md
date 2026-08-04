# Journal-style citation numbers on @ mentions — Design

Date: 2026-08-04

## Goal

When a user @-mentions a file in the chat composer, show a sequential
journal-style citation number `[n]` inline in the textarea (blended with the
word) and the same number on the mention chip badge above. Numbers are a
composer-side UI affordance only: on send, tags expand to their paths exactly
as today, and real (paperclip) attachments are untouched.

## Decisions (from brainstorming)

- **Sent prompt**: path only (current behavior). Numbers never reach the model.
- **Renumbering**: numbers derived from tag position (1, 2, 3…), auto-renumber
  when a tag is removed — always contiguous like a journal.

## Architecture

All display/mapping logic lives in `src/renderer/src/screens/Chat/mention.ts`
(pure functions, no DOM/IPC — unit-testable).

### `mention.ts`

- **New helper** `citationMarker(index: number): string` → `[${index + 1}]`.
  Single source of truth for the display marker; its length varies with the
  number of digits.
- **`displayText(raw)`** — replace each tag with `citationMarker(tagIndex)`
  (1-based index among `parseTags(raw)`) instead of the single ZWSP. This is
  the visible "badge blended with the word".
- **`displayToRawPos(raw, displayPos)`** — iterate `parseTags(raw)` and
  account for each tag's variable-length marker (compute
  `citationMarker(i).length` per tag) instead of the constant
  `TAG_DISPLAY_CHAR.length`. Any offset inside a marker still maps to
  `tag.start` so backspace deletes the whole tag.
- **`rawToDisplayPos(raw, rawPos)`** — mirror the same per-tag marker length.
- `expandTags` unchanged (path only).
- `TAG_DISPLAY_CHAR` ZWSP constant no longer used by displayText (kept only if
  referenced elsewhere; otherwise removed).

### `ChatInput.tsx`

- Chip row: each `.chat-mention-tag` renders a numbered badge
  (`<span className="chat-mention-tag-num">{index + 1}</span>`) before the
  icon, computed from the tag's index in `parseTags(input)` — same order as
  the textarea markers.

### CSS (`main.css`)

- `.chat-mention-tag-num` — small badge (e.g. 14px square/circle, accent-tinted
  background, mono digits, 10px font) so it reads as a citation index.

## Testing

- `mention.test.ts`:
  - `displayText` emits `[1]`, `[2]`… for consecutive tags.
  - `displayText` output for a multi-digit count (e.g. 10+ tags) has correct
    marker lengths.
  - `displayToRawPos`/`rawToDisplayRaw` round-trip with variable-length
    markers (single + multi-digit).
  - Backspace inside a marker maps to `tag.start` (whole-tag delete preserved).
  - Removing the middle tag renumbers the rest (contiguous).
  - `expandTags` unchanged: replaces tags with paths only.

## Out of scope

- Sending citation numbers to the model.
- Numbering on paperclip attachments.
- The mention dropdown itself.
