# Journal-Style Citation Numbers on @ Mentions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a sequential journal-style citation number `[n]` inline in the chat composer where an @-mention sits, and the same number on the mention chip badge — purely a composer UI affordance; sent prompts still expand tags to paths only.

**Architecture:** All display/marker math lives in `mention.ts` (pure functions): a `citationMarker(index)` helper produces `[n]`, `displayText` renders `[n]` per tag, and `displayToRawPos`/`rawToDisplayPos` use per-tag marker length (variable: `[1]` vs `[12]`). ChatInput's chip row adds a numbered badge. CSS styles the badge.

**Tech Stack:** TypeScript, React, vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-mention-citations-design.md`

---

### Task 1: Citation marker + displayText (TDD)

**Files:**
- Modify: `src/renderer/src/screens/Chat/mention.ts`
- Test: `src/renderer/src/screens/Chat/mention.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/screens/Chat/mention.test.ts` (inside a new `describe("citation markers")` block):

```ts
describe("citation markers", () => {
  const tag = (name: string, path: string): string =>
    MENTION_START + name + MENTION_SEP + path + MENTION_END;

  it("renders [1], [2]... for consecutive tags", () => {
    const raw = `see ${tag("a.ts", "/x/a.ts")} and ${tag("b.ts", "/y/b.ts")}`;
    expect(displayText(raw)).toBe("see [1] and [2]");
  });

  it("citationMarker produces bracketed 1-based indices", () => {
    expect(citationMarker(0)).toBe("[1]");
    expect(citationMarker(1)).toBe("[2]");
    expect(citationMarker(11)).toBe("[12]");
  });

  it("marker lengths scale with the number of digits", () => {
    const raw = Array.from({ length: 12 }, (_, i) =>
      tag(`f${i}.ts`, `/p/f${i}.ts`),
    ).join(" ");
    const d = displayText(raw);
    expect(d).toBe(
      Array.from({ length: 12 }, (_, i) => `[${i + 1}]`).join(" "),
    );
    expect(d.length).toBeGreaterThan(12 * 3);
  });

  it("leaves plain text untouched", () => {
    expect(displayText("hello @world")).toBe("hello @world");
  });

  it("does not leak PUA markers", () => {
    const raw = `see ${tag("main.js", "/a/b/main.js")} now`;
    expect(displayText(raw)).not.toMatch(/[\uE000\uE001\uE002]/);
  });
});
```

Also update the import line at the top of `mention.test.ts` to include `citationMarker`:
```ts
import {
  MENTION_END,
  MENTION_SEP,
  MENTION_START,
  citationMarker,
  displayText,
  ...
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: FAIL — `citationMarker` is not exported; displayText still emits ZWSP.

- [ ] **Step 3: Implement citationMarker + new displayText**

In `src/renderer/src/screens/Chat/mention.ts`, replace the `TAG_DISPLAY_CHAR`/`displayText` section:

```ts
/**
 * Journal-style citation marker for a mention tag: `[1]`, `[2]`, ...
 * `index` is the 0-based tag position; the marker is 1-based. The length
 * varies with the number of digits, so position-mapping functions must use
 * this helper (never a constant) when walking display space.
 */
export function citationMarker(index: number): string {
  return `[${index + 1}]`;
}

export function displayText(raw: string): string {
  const tags = parseTags(raw);
  if (tags.length === 0) return raw;
  let out = "";
  let cursor = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    out += raw.slice(cursor, tag.start);
    out += citationMarker(i);
    cursor = tag.end;
  }
  out += raw.slice(cursor);
  return out;
}
```

Remove the now-unused `TAG_DISPLAY_CHAR` export if nothing else imports it (grep `TAG_DISPLAY_CHAR` across `src/renderer/src` first; if ChatInput or tests still import it, keep it and update those imports in Task 2).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: PASS — including the pre-existing `displayText` describe block? NO — those old tests expect ZWSP output and will now FAIL. Update them in Step 5.

- [ ] **Step 5: Update the old displayText tests to the new marker format**

In `mention.test.ts`, rewrite the `describe("displayText / displayToRawPos / rawToDisplayPos")` block (lines ~268-310) to expect `[n]` markers and per-tag variable lengths:

```ts
describe("displayText / displayToRawPos / rawToDisplayPos", () => {
  const tag = (name: string, path: string): string =>
    MENTION_START + name + MENTION_SEP + path + MENTION_END;

  it("collapses tag inner text to a citation marker (no PUA leak)", () => {
    const raw = `see ${tag("main.js", "/a/b/main.js")} now`;
    const d = displayText(raw);
    expect(d).toBe("see [1] now");
    expect(d).not.toMatch(/[\uE000\uE001\uE002]/);
    expect(d.length).toBeLessThan(raw.length);
  });

  it("round-trips caret positions before, inside, and after a tag", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    const d = displayText(raw); // "a [1] z"
    const markerLen = citationMarker(0).length;
    expect(displayToRawPos(raw, 2)).toBe(2);
    // Inside the marker maps to the tag start (whole-tag delete).
    expect(displayToRawPos(raw, 2 + 1)).toBe(2);
    expect(displayToRawPos(raw, 2 + markerLen)).toBe(2 + tag("x.ts", "/p/x.ts").length);
    expect(displayToRawPos(raw, 2 + markerLen + 1)).toBe(2 + tag("x.ts", "/p/x.ts").length + 1);
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
  });

  it("round-trips raw offsets to display offsets", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    const d = displayText(raw);
    const markerLen = citationMarker(0).length;
    expect(rawToDisplayPos(raw, 0)).toBe(0);
    expect(rawToDisplayPos(raw, 2)).toBe(2);
    expect(rawToDisplayPos(raw, 2 + tag("x.ts", "/p/x.ts").length)).toBe(2 + markerLen);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
  });

  it("handles multiple tags with variable marker lengths", () => {
    const raw = `${tag("a.ts", "/x/a.ts")} ${tag("b.ts", "/y/b.ts")}`;
    const d = displayText(raw);
    expect(d).toBe("[1] [2]");
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
  });

  it("leaves plain text untouched", () => {
    expect(displayText("hello @world")).toBe("hello @world");
    expect(displayToRawPos("hello", 3)).toBe(3);
  });
});
```

- [ ] **Step 6: Run the full mention test suite**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: PASS (all blocks, including citation markers).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Chat/mention.ts src/renderer/src/screens/Chat/mention.test.ts
git commit -m "feat(chat): journal citation markers [n] in mention displayText"
```

---

### Task 2: Update displayToRawPos / rawToDisplayPos for variable marker length

**Files:**
- Modify: `src/renderer/src/screens/Chat/mention.ts`
- Test: `src/renderer/src/screens/Chat/mention.test.ts`

- [ ] **Step 1: Write the failing tests (multi-digit mapping)**

Append to the `describe("citation markers")` block in `mention.test.ts`:

```ts
  it("maps positions correctly with 10+ tags (multi-digit markers)", () => {
    const raw = Array.from({ length: 12 }, (_, i) =>
      tag(`f${i}.ts`, `/p/f${i}.ts`),
    ).join(" ");
    const d = displayText(raw);
    // Caret at the end of the whole display maps to the end of raw.
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
    // Caret just after the [10] marker lands at the end of tag index 9.
    const tenthStart = Array.from({ length: 9 }, (_, i) =>
      tag(`f${i}.ts`, `/p/f${i}.ts`),
    ).join(" ").length + 1;
    const tenthTag = tag(`f9.ts`, `/p/f9.ts`);
    const markerLen = citationMarker(9).length;
    expect(rawToDisplayPos(raw, tenthStart + tenthTag.length)).toBe(
      tenthStart + markerLen,
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: FAIL — the mapping still uses the constant ZWSP length.

- [ ] **Step 3: Rewrite both mapping functions**

In `src/renderer/src/screens/Chat/mention.ts`, replace `displayToRawPos` and `rawToDisplayPos`:

```ts
export function displayToRawPos(raw: string, displayPos: number): number {
  const tags = parseTags(raw);
  let d = 0;
  let r = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const markerLen = citationMarker(i).length;
    const outsideLen = tag.start - r;
    if (displayPos <= d + outsideLen) return r + (displayPos - d);
    d += outsideLen;
    if (displayPos < d + markerLen) return tag.start;
    d += markerLen;
    r = tag.end;
  }
  return r + (displayPos - d);
}

export function rawToDisplayPos(raw: string, rawPos: number): number {
  const tags = parseTags(raw);
  let d = 0;
  let lastEnd = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (rawPos <= tag.start) break;
    d += tag.start - lastEnd;
    if (rawPos < tag.end) return d;
    d += citationMarker(i).length;
    lastEnd = tag.end;
  }
  return d + (rawPos - lastEnd);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: PASS.

- [ ] **Step 5: Check for TAG_DISPLAY_CHAR references and clean up**

Run: `rg -n "TAG_DISPLAY_CHAR" src/renderer/src`
Expected: if only `mention.ts` references it (no imports elsewhere), delete its declaration from `mention.ts` and any leftover import in `mention.test.ts`/`ChatInput.tsx`. If ChatInput imports it, update that import to `citationMarker` (and see Task 3 for the chip badge).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Chat/mention.ts src/renderer/src/screens/Chat/mention.test.ts
git commit -m "fix(chat): variable-length citation markers in position mapping"
```

---

### Task 3: Chip badge number in ChatInput

**Files:**
- Modify: `src/renderer/src/screens/Chat/ChatInput.tsx` (chip row, ~lines 994-1023)
- Modify: `src/renderer/src/assets/main.css` (badge styles)
- Test: `src/renderer/src/screens/Chat/ChatInput.test.tsx` (chip badge render)

- [ ] **Step 1: Write the failing component test**

Append to `src/renderer/src/screens/Chat/ChatInput.test.tsx`:

```tsx
import { parseTags } from "./mention";

describe("ChatInput - mention chip citation badges", () => {
  it("renders a numbered badge per mention chip", () => {
    const { textarea } = renderInput();
    // Insert two mention tags via the textarea value (sentinel markers).
    const tag = (name: string, path: string): string =>
      "\uE000" + name + "\uE001" + path + "\uE002";
    fireEvent.change(textarea, {
      target: {
        value: `see ${tag("a.ts", "/x/a.ts")} and ${tag("b.ts", "/y/b.ts")}`,
      },
    });
    const badges = screen.getAllByText(/^\d+$/);
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe("1");
    expect(badges[1].textContent).toBe("2");
  });

  it("renumbers chips when the first mention is removed", () => {
    const { textarea } = renderInput();
    const tag = (name: string, path: string): string =>
      "\uE000" + name + "\uE001" + path + "\uE002";
    const t1 = tag("a.ts", "/x/a.ts");
    const t2 = tag("b.ts", "/y/b.ts");
    fireEvent.change(textarea, { target: { value: `${t1} ${t2}` } });
    // Remove the first chip via its remove button.
    const removeButtons = screen.getAllByLabelText("Remove file");
    fireEvent.click(removeButtons[0]);
    const badges = screen.getAllByText(/^\d+$/);
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("1");
    expect(parseTags((textarea as HTMLTextAreaElement).value)).toHaveLength(1);
  });
});
```

Note: `renderInput` is already defined in that file; `screen` and `fireEvent` are already imported. If `parseTags` import is redundant given the assertions, keep it minimal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Chat/ChatInput.test.tsx`
Expected: FAIL — no numbered badge elements yet.

- [ ] **Step 3: Add the badge to the chip row**

In `src/renderer/src/screens/Chat/ChatInput.tsx`, in the chip row map (currently `parseTags(input).map((tag) => ...)`), change to use the index:

```tsx
{parseTags(input).map((tag, idx) => (
  <div
    key={`${tag.path}@${tag.start}`}
    className="chat-mention-tag"
    title={tag.path}
  >
    <span className="chat-mention-tag-num">{idx + 1}</span>
    <FileText size={12} className="chat-mention-tag-icon" />
    <span className="chat-mention-tag-name">
      {truncatePath(tag.name, 16, 40)}
    </span>
    <button ...>...</button>
  </div>
))}
```

- [ ] **Step 4: Add the badge styles**

Append to `src/renderer/src/assets/main.css` (near the existing `.chat-mention-tag` rules around line 6659):

```css
/* Journal-style citation number on mention chips. */
.chat-mention-tag-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent-text);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run:
```bash
npx vitest run src/renderer/src/screens/Chat/ChatInput.test.tsx src/renderer/src/screens/Chat/mention.test.ts
npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Chat/ChatInput.tsx src/renderer/src/screens/Chat/ChatInput.test.tsx src/renderer/src/assets/main.css
git commit -m "feat(chat): numbered citation badges on mention chips"
```

---

### Task 4: Docs + full verification

**Files:**
- Modify: `lat.md/chat-performance.md` (or a new `lat.md/mentions.md`)

- [ ] **Step 1: Write the lat.md docs**

Create `lat.md/mentions.md`:

```markdown
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
```

Add the index entry to `lat.md/lat.md`:
```
- [[mentions]] - journal-style citation numbers on @-mention tags: [n] inline in the composer and on the chip badges, derived from tag position and renumbering on removal.
```

- [ ] **Step 2: Run the full check suite**

Run:
```bash
npm run typecheck
npm exec --yes --package=lat.md -- lat check
npx vitest run src/renderer/src/screens/Chat/mention.test.ts src/renderer/src/screens/Chat/ChatInput.test.tsx
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add lat.md/mentions.md lat.md/lat.md
git commit -m "docs(chat): document @-mention citation markers"
```
