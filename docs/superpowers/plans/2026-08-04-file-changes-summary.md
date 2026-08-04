# File-Changes Summary After Assistant Responses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a completed assistant turn that modified files, show a "N files changed" badge on the response bubble; clicking opens a dialog with a side-by-side before/after diff per file.

**Architecture:** The dashboard transport (`useDashboardChatTransport.ts`) already streams `tool.start`/`tool.complete` events. A per-turn accumulator snapshots file content before (on `tool.start` of a write tool) and after (on `tool.complete`), attaches the list to the assistant message on `message.complete` via a new `fileChanges` field. `MessageRow` renders the badge; `FileChangesDialog` shows the diff.

**Tech Stack:** TypeScript, React, CodeMirror 6 (already installed), vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-file-changes-summary-design.md`

---

### Task 1: FileChange type + path extraction helper (TDD)

**Files:**
- Modify: `src/renderer/src/screens/Chat/types.ts` (add `FileChange` + `fileChanges` on `ChatBubbleMessage`)
- Create: `src/renderer/src/screens/Chat/fileChanges.ts` (path extraction helper)
- Test: `src/renderer/src/screens/Chat/fileChanges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/screens/Chat/fileChanges.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { extractToolPath } from "./fileChanges";

describe("extractToolPath", () => {
  it("reads a plain path key from args", () => {
    expect(extractToolPath({ path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(extractToolPath({ file_path: "/a/c.ts" })).toBe("/a/c.ts");
    expect(extractToolPath({ file: "/a/d.ts" })).toBe("/a/d.ts");
    expect(extractToolPath({ target: "/a/e.ts" })).toBe("/a/e.ts");
  });

  it("reads a nested path inside a stringified arg", () => {
    expect(extractToolPath({ path: "/a/x.ts", content: "hi" })).toBe("/a/x.ts");
  });

  it("falls back to scanning the JSON text for an absolute path", () => {
    expect(
      extractToolPath({ file_path: "/repo/src/main.ts", patch: "@@" }),
    ).toBe("/repo/src/main.ts");
    expect(extractToolPath({ filename: "C:\\repo\\a\\b.ts" })).toBe(
      "C:\\repo\\a\\b.ts",
    );
  });

  it("returns null for unresolvable args", () => {
    expect(extractToolPath({ content: "just text" })).toBeNull();
    expect(extractToolPath({})).toBeNull();
    expect(extractToolPath("not an object")).toBeNull();
  });

  it("prefers absolute-looking paths over relative", () => {
    expect(
      extractToolPath({ file_path: "relative.ts", absolute_path: "/abs/rel.ts" }),
    ).toBe("/abs/rel.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Chat/fileChanges.test.ts`
Expected: FAIL — module `./fileChanges` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/screens/Chat/fileChanges.ts`:
```ts
/**
 * Pure helpers for the per-turn file-changes summary.
 */

const ABSOLUTE_PATH_RE =
  /^[A-Za-z]:[\\/]|\/(?!\/)/;

/** Candidate keys for a file path inside a tool-call args object. */
const PATH_KEYS = [
  "path",
  "file_path",
  "filepath",
  "file",
  "target",
  "filename",
  "absolute_path",
  "absolutePath",
  "dest",
  "destination",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeAbsolutePath(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  // Windows drive letter (C:\...) or POSIX absolute (/...). Reject
  // whitespace/quotes so "my file path" or JSON noise don't match.
  if (/[\s"']/.test(trimmed)) return false;
  return ABSOLUTE_PATH_RE.test(trimmed);
}

/**
 * Best-effort extraction of the file path a write tool operates on.
 * Returns null when no absolute path can be found.
 */
export function extractToolPath(
  args: unknown,
): string | null {
  if (!isRecord(args)) return null;

  // 1. Direct keys.
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && looksLikeAbsolutePath(value)) {
      return value.trim();
    }
  }

  // 2. Scan the stringified args for the first absolute path.
  let jsonText = "";
  try {
    jsonText = JSON.stringify(args);
  } catch {
    jsonText = String(args);
  }
  const matches = jsonText.match(/"[^"]*[\\/][^"]*"/g) || [];
  for (const raw of matches) {
    const candidate = raw.slice(1, -1);
    if (looksLikeAbsolutePath(candidate)) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Chat/fileChanges.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the FileChange type**

In `src/renderer/src/screens/Chat/types.ts`, add before `ChatBubbleMessage`:
```ts
/** One file modified by an assistant turn; before/after content captured
 *  live from the tool stream (null before = created, null after = deleted). */
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}
```
And add to `ChatBubbleMessage`:
```ts
  /** Files this assistant turn wrote/edited/deleted (dashboard transport only). */
  fileChanges?: FileChange[];
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Chat/types.ts src/renderer/src/screens/Chat/fileChanges.ts src/renderer/src/screens/Chat/fileChanges.test.ts
git commit -m "feat(chat): FileChange type + write-tool path extraction helper"
```

---

### Task 2: Per-turn capture in the dashboard transport

**Files:**
- Modify: `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts` (tool.start / tool.complete / message.complete handlers)
- Modify: `src/renderer/src/screens/Chat/dashboardEventAdapter.ts` (export `WRITE_TOOL_NAMES` list for reuse)

- [ ] **Step 1: Export the write-tool name list**

In `src/renderer/src/screens/Chat/dashboardEventAdapter.ts`, add near the top:
```ts
/** Tool names that mutate files — captured for the file-changes summary. */
export const WRITE_TOOL_NAMES = [
  "write_file", "edit_file", "patch_file", "create_file", "delete_file",
  "move_file", "copy_file", "rename_file", "apply_patch", "str_replace",
  "save_file",
];
```

- [ ] **Step 2: Add the accumulator + handlers**

In `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts`:

1. Import `extractToolPath` and `WRITE_TOOL_NAMES`:
```ts
import { extractToolPath } from "../fileChanges";
import { WRITE_TOOL_NAMES } from "../dashboardEventAdapter";
import type { FileChange } from "../types";
```

2. Near the other refs (around `recreateRuntimeSessionRef`), add:
```ts
  // Per-turn file-change capture: path → latest before/after pair. Reset on
  // each new user turn; attached to the assistant bubble on message.complete.
  const fileChangesRef = useRef<Map<string, FileChange>>(new Map());
```

3. In the `tool.start` case of the stream handler (inside the `applyDashboardStreamEvent` call site — find where `event.type === "tool.start"` is handled; the plan-mode interceptor block is at ~line 1067), after the plan-mode block, add a snapshot. The tool.start branch currently falls through to `applyDashboardStreamEvent`; insert BEFORE that generic handling:

```ts
      // FILE-CHANGES: snapshot the file before a write tool runs.
      if (event.type === "tool.start" && event.payload && typeof event.payload === "object") {
        const toolName = String(
          (event.payload as { name?: string; tool_name?: string }).name ||
          (event.payload as { tool_name?: string }).tool_name || "",
        ).toLowerCase();
        if (WRITE_TOOL_NAMES.some((w) => toolName.includes(w))) {
          const args = (event.payload as { args?: unknown }).args;
          const path = extractToolPath(args);
          const callId = String(
            (event.payload as { tool_id?: string }).tool_id ||
            (event.payload as { tool_call_id?: string }).tool_call_id || "",
          );
          if (path && !fileChangesRef.current.has(path)) {
            // Record before-content (best-effort; null when the file
            // doesn't exist yet → created).
            void window.hermesAPI
              .readFile(path)
              .then((res) => {
                const existing = fileChangesRef.current.get(path);
                if (existing?.after !== undefined) return; // already completed
                fileChangesRef.current.set(path, {
                  path,
                  before: res?.content ?? null,
                  after: null,
                });
                if (callId) pendingFileChangeCallIdRef.current = callId;
              })
              .catch(() => undefined);
          }
        }
      }
```

4. Add the ref for the pending callId (next to `fileChangesRef`):
```ts
  const pendingFileChangeCallIdRef = useRef<string>("");
```

5. In the `tool.complete` branch (before the generic `applyDashboardStreamEvent`), add:
```ts
      if (event.type === "tool.complete" && event.payload && typeof event.payload === "object") {
        const callId = String(
          (event.payload as { tool_id?: string }).tool_id ||
          (event.payload as { tool_call_id?: string }).tool_call_id || "",
        );
        if (
          callId &&
          pendingFileChangeCallIdRef.current === callId
        ) {
          pendingFileChangeCallIdRef.current = "";
          // Read after-content for every path captured this turn whose
          // after is still null (the just-completed write).
          for (const [path, change] of fileChangesRef.current) {
            if (change.after !== null) continue;
            void window.hermesAPI
              .readFile(path)
              .then((res) => {
                fileChangesRef.current.set(path, {
                  path,
                  before: change.before,
                  after: res?.content ?? null,
                });
              })
              .catch(() => undefined);
          }
        }
      }
```

6. In the `message.complete` handler (find where `activeTurn.status = "completed"` / the final bubble is set), after the turn is marked complete and BEFORE the accumulator is cleared, attach the changes. Insert near the completion finalization:
```ts
      if (fileChangesRef.current.size > 0) {
        const changes = Array.from(fileChangesRef.current.values()).filter(
          (c) => c.after !== null || c.before !== null,
        );
        if (changes.length > 0) {
          setMessages((prev) => {
            const idx = prev.length - 1;
            const last = prev[idx];
            if (last && last.role === "agent" && "content" in last) {
              const next = [...prev];
              next[idx] = { ...last, fileChanges: changes };
              messagesRef.current = next;
              return next;
            }
            return prev;
          });
        }
        fileChangesRef.current = new Map();
        pendingFileChangeCallIdRef.current = "";
      }
```

7. Reset the accumulator when a new user turn starts (in the submit path, near where `activeTurnRef.current = ...` is set):
```ts
      fileChangesRef.current = new Map();
      pendingFileChangeCallIdRef.current = "";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts src/renderer/src/screens/Chat/dashboardEventAdapter.ts
git commit -m "feat(chat): capture per-turn file before/after from tool stream"
```

---

### Task 3: FileChangesDialog component

**Files:**
- Create: `src/renderer/src/screens/Chat/FileChangesDialog.tsx`
- Modify: `src/renderer/src/assets/main.css` (dialog + badge styles)

- [ ] **Step 1: Write the component**

Create `src/renderer/src/screens/Chat/FileChangesDialog.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import type { FileChange } from "./types";

function diffStats(change: FileChange): string {
  if (change.before === null && change.after !== null) return "Created";
  if (change.before !== null && change.after === null) return "Deleted";
  const beforeLines = (change.before ?? "").split("\n").length;
  const afterLines = (change.after ?? "").split("\n").length;
  const added = Math.max(0, afterLines - beforeLines);
  const removed = Math.max(0, beforeLines - afterLines);
  return `+${added} −${removed} lines`;
}

function ReadOnlyCode({ content }: { content: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      editable: false,
      state: EditorState.create({
        doc: content,
        extensions: [oneDark, EditorView.editable.of(false)],
      }),
    });
    return () => view.destroy();
  }, [content]);
  return <div ref={hostRef} className="file-changes-code" />;
}

export function FileChangesDialog({
  changes,
  onClose,
}: {
  changes: FileChange[];
  onClose: () => void;
}): React.JSX.Element {
  const [selectedPath, setSelectedPath] = useState<string>(changes[0]?.path ?? "");
  const selected = changes.find((c) => c.path === selectedPath) ?? changes[0];

  const fileName = useMemo(
    () => selectedPath.split(/[\\/]/).pop() || selectedPath,
    [selectedPath],
  );

  return (
    <div className="file-changes-overlay" onClick={onClose}>
      <div className="file-changes-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="file-changes-header">
          <span className="file-changes-title">File changes</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="file-changes-body">
          <div className="file-changes-list">
            {changes.map((c) => (
              <button
                key={c.path}
                type="button"
                className={`file-changes-item ${c.path === selectedPath ? "active" : ""}`}
                onClick={() => setSelectedPath(c.path)}
                title={c.path}
              >
                <span className="file-changes-item-name">
                  {c.path.split(/[\\/]/).pop() || c.path}
                </span>
                <span className="file-changes-item-stats">{diffStats(c)}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="file-changes-diff">
              <div className="file-changes-diff-header">
                <span className="file-changes-diff-file">{fileName}</span>
                <span className="file-changes-diff-stats">{diffStats(selected)}</span>
              </div>
              <div className="file-changes-diff-panes">
                <div className="file-changes-pane">
                  <div className="file-changes-pane-title">Before</div>
                  <ReadOnlyCode content={selected.before ?? ""} />
                </div>
                <div className="file-changes-pane">
                  <div className="file-changes-pane-title">After</div>
                  <ReadOnlyCode content={selected.after ?? ""} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/renderer/src/assets/main.css`:
```css
/* ── File-changes summary dialog ── */
.file-changes-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-changes-dialog {
  width: min(900px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.file-changes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.file-changes-title {
  font-weight: 700;
  font-size: 14px;
}
.file-changes-body {
  display: flex;
  min-height: 0;
  flex: 1;
}
.file-changes-list {
  width: 260px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file-changes-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.file-changes-item.active {
  background: var(--accent-subtle);
  color: var(--text-primary);
}
.file-changes-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.file-changes-item-stats {
  font-size: 10.5px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.file-changes-diff {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.file-changes-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.file-changes-diff-file {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  font-weight: 600;
}
.file-changes-diff-stats {
  font-size: 11px;
  color: var(--text-muted);
}
.file-changes-diff-panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.file-changes-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.file-changes-pane:last-child {
  border-right: none;
}
.file-changes-pane-title {
  padding: 6px 12px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.file-changes-code {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #282c34;
}
.file-changes-code .cm-editor {
  height: 100%;
  font-size: 12.5px;
}
.file-changes-code .cm-scroller {
  font-family: var(--font-mono);
  line-height: 1.55;
}

/* Badge on assistant bubbles */
.chat-file-changes-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11.5px;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.chat-file-changes-badge:hover {
  background: var(--accent-subtle);
  color: var(--text-primary);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Chat/FileChangesDialog.tsx src/renderer/src/assets/main.css
git commit -m "feat(chat): file-changes diff dialog with side-by-side before/after"
```

---

### Task 4: Badge on assistant bubble + dialog wiring

**Files:**
- Modify: `src/renderer/src/screens/Chat/MessageRow.tsx` (badge render + click)
- Modify: `src/renderer/src/screens/Chat/Chat.tsx` (dialog state + pass to MessageList)

- [ ] **Step 1: Add the badge to MessageRow**

In `src/renderer/src/screens/Chat/MessageRow.tsx`:

1. Import the dialog + type:
```tsx
import { useState } from "react";
import { FileChangesDialog } from "./FileChangesDialog";
import type { FileChange } from "./types";
```

2. Add props to the component signature (find the `interface`/props destructure): add
```ts
  /** Open the file-changes dialog for this bubble (dashboard transport). */
  onOpenFileChanges?: (changes: FileChange[]) => void;
```

3. Inside the bubble (after the content/attachments blocks, before the closing `</div>` of `.chat-bubble`), add:
```tsx
        {(msg as ChatBubbleMessage).fileChanges &&
          (msg as ChatBubbleMessage).fileChanges!.length > 0 && (
            <button
              type="button"
              className="chat-file-changes-badge"
              onClick={() =>
                onOpenFileChanges?.((msg as ChatBubbleMessage).fileChanges!)
              }
              title="View file changes"
            >
              <FilePlus2 size={13} />
              {(msg as ChatBubbleMessage).fileChanges!.length} file
              {(msg as ChatBubbleMessage).fileChanges!.length > 1 ? "s" : ""} changed
            </button>
          )}
```
(Import `FilePlus2` from `lucide-react` alongside existing icons.)

- [ ] **Step 2: Wire the dialog in Chat.tsx**

In `src/renderer/src/screens/Chat/Chat.tsx`:

1. Import:
```ts
import { FileChangesDialog } from "./FileChangesDialog";
import type { FileChange } from "./types";
```

2. Add state:
```ts
  const [fileChangesOpen, setFileChangesOpen] = useState<FileChange[] | null>(
    null,
  );
```

3. Pass to MessageList (find the `<MessageList ...>` usage):
```tsx
              onOpenFileChanges={(changes) => setFileChangesOpen(changes)}
```

4. Verify `MessageList` accepts the prop and forwards to `MessageRow` (add if missing in `MessageList.tsx`: prop `onOpenFileChanges` in its props interface, pass through to `MessageRow`).

5. Render the dialog near the end of the Chat return:
```tsx
      {fileChangesOpen && (
        <FileChangesDialog
          changes={fileChangesOpen}
          onClose={() => setFileChangesOpen(null)}
        />
      )}
```

- [ ] **Step 3: Typecheck + tests**

Run:
```bash
npm run typecheck
npx vitest run src/renderer/src/screens/Chat/fileChanges.test.ts src/renderer/src/screens/Chat/ChatInput.test.tsx src/renderer/src/screens/Chat/mention.test.ts
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Chat/MessageRow.tsx src/renderer/src/screens/Chat/MessageList.tsx src/renderer/src/screens/Chat/Chat.tsx
git commit -m "feat(chat): file-changes badge on assistant bubbles + dialog wiring"
```

---

### Task 5: Docs + full verification

**Files:**
- Create: `lat.md/file-changes.md`
- Modify: `lat.md/lat.md`

- [ ] **Step 1: Write the lat.md docs**

Create `lat.md/file-changes.md`:
```markdown
# File-changes summary

Assistant turns that modify files show a "N files changed" badge on the
response bubble; clicking opens a dialog with a side-by-side before/after diff.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] captures
per-turn changes live from the tool stream: on `tool.start` of a write tool
(`WRITE_TOOL_NAMES` in the dashboard event adapter), [[src/renderer/src/screens/Chat/fileChanges.ts#extractToolPath]]
pulls the target path from the tool args and the file is snapshotted before;
on `tool.complete` the after-content is read. The accumulated
`{ path, before, after }` list is attached to the assistant message
(`fileChanges` on `ChatBubbleMessage`) at `message.complete`. [[src/renderer/src/screens/Chat/MessageRow.tsx]]
renders the badge; [[src/renderer/src/screens/Chat/FileChangesDialog.tsx]]
shows the list + side-by-side read-only CodeMirror panes.

Capture is dashboard-transport only — the legacy transport's progress strings
don't carry reliable paths. Reads are best-effort; failures are swallowed.
```

Add the index entry to `lat.md/lat.md`:
```
- [[file-changes]] - per-turn file-change summary: badge on assistant bubbles, side-by-side before/after dialog, captured live from the dashboard tool stream.
```

- [ ] **Step 2: Run the full check suite**

Run:
```bash
npm run typecheck
npm exec --yes --package=lat.md -- lat check
npx vitest run src/renderer/src/screens/Chat/fileChanges.test.ts
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add lat.md/file-changes.md lat.md/lat.md
git commit -m "docs(chat): document file-changes summary"
```
