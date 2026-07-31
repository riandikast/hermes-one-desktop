# Multi-Root Workspace + Mention Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-folder session context (picker, agent prompt, sidebar, @-mentions), mention tags as removable badges, sidebar folder context menu + search, and a fast terminal launcher.

**Architecture:** Pure display-mapping functions in `mention.ts` (TDD'd) let the plain textarea show tags as invisible markers while a chip row renders badges. The main process widens the per-session folder store to an array with lazy migration. WorktreePanel renders one collapsible root per folder and reuses `rankMentions` for search. Terminal resolution gets static-path fast path, parallel cached Appx probes, and a startup warm.

**Tech Stack:** Electron, better-sqlite3, React, lucide-react, vitest.

Spec: `docs/superpowers/specs/2026-07-31-multi-root-workspace-design.md`

---

### Task 1: mention.ts — display/raw mapping helpers (TDD)

**Files:**
- Modify: `src/renderer/src/screens/Chat/mention.ts`
- Test: `src/renderer/src/screens/Chat/mention.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("displayText / displayToRawPos / rawToDisplayPos", () => {
  const tag = (name: string, path: string): string =>
    MENTION_START + name + MENTION_SEP + path + MENTION_END;

  it("collapses tag inner text to the invisible sentinel trio", () => {
    const raw = `see ${tag("main.js", "/a/b/main.js")} now`;
    const d = displayText(raw);
    expect(d).toBe(`see ${MENTION_START}${MENTION_SEP}${MENTION_END} now`);
    expect(d.length).toBeLessThan(raw.length);
  });

  it("round-trips caret positions before, inside, and after a tag", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    // before tag: raw 0..2 == display 0..2
    expect(displayToRawPos(raw, 2)).toBe(2);
    // inside tag: display offset 3 (first sentinel) maps to tag start
    const d = displayText(raw);
    const tagStartD = d.indexOf(MENTION_START);
    expect(displayToRawPos(raw, tagStartD)).toBe(2);
    expect(displayToRawPos(raw, tagStartD + 3)).toBe(2 + tag("x.ts", "/p/x.ts").length);
    // after tag
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
  });

  it("round-trips raw offsets to display offsets", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    const d = displayText(raw);
    expect(rawToDisplayPos(raw, 0)).toBe(0);
    expect(rawToDisplayPos(raw, 2)).toBe(2);
    expect(rawToDisplayPos(raw, 2 + tag("x.ts", "/p/x.ts").length)).toBe(d.indexOf(MENTION_END) + 1);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
  });

  it("handles multiple tags", () => {
    const raw = `${tag("a.ts", "/x/a.ts")} ${tag("b.ts", "/y/b.ts")}`;
    const d = displayText(raw);
    expect((d.match(/[\uE000]/g) ?? []).length).toBe(2);
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
  });

  it("leaves plain text untouched", () => {
    expect(displayText("hello @world")).toBe("hello @world");
    expect(displayToRawPos("hello", 3)).toBe(3);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/renderer/src/screens/Chat/mention.test.ts`
Expected: FAIL (displayText/displayToRawPos/rawToDisplayPos undefined)

- [ ] **Step 3: Implement in mention.ts**

```ts
/**
 * Display form of the raw input: each tag's inner text is replaced by the
 * invisible sentinel trio, so the textarea shows no tag text (badges render
 * in a chip row above). Sentinels are zero-width PUA chars.
 */
export function displayText(raw: string): string {
  return raw.replace(MENTION_RE, MENTION_START + MENTION_SEP + MENTION_END);
}

/**
 * Map a caret/selection offset in DISPLAY space to the corresponding offset
 * in RAW space. Offsets inside a tag (the 3 sentinel chars) map to the tag's
 * raw start; offsets at/after the tag end map to the tag's raw end.
 */
export function displayToRawPos(raw: string, displayPos: number): number {
  let d = 0;
  let r = 0;
  for (const tag of parseTags(raw)) {
    const outsideLen = tag.start - r;
    if (displayPos <= d + outsideLen) return r + (displayPos - d);
    d += outsideLen;
    if (displayPos < d + 3) return tag.start;
    d += 3;
    r = tag.end;
  }
  return r + (displayPos - d);
}

/**
 * Map a RAW offset to DISPLAY space (for setSelectionRange after inserts).
 */
export function rawToDisplayPos(raw: string, rawPos: number): number {
  let d = 0;
  let lastEnd = 0;
  for (const tag of parseTags(raw)) {
    if (rawPos <= tag.start) break;
    d += tag.start - lastEnd;
    if (rawPos <= tag.end) return d;
    d += 3;
    lastEnd = tag.end;
  }
  return d + (rawPos - lastEnd);
}
```

- [ ] **Step 4: Run tests, expect 35 passed**
- [ ] **Step 5: Commit** `feat(chat): display/raw mapping helpers for mention badges`

### Task 2: ChatInput — badge chips + hidden tag text

**Files:**
- Modify: `src/renderer/src/screens/Chat/ChatInput.tsx`
- Modify: `src/renderer/src/assets/main.css` (new `.chat-mention-tag-row` + `.chat-mention-tag` classes, modeled on `.chat-attachment-strip`/`.attachment-chip` at main.css:6162–6225)

- [ ] **Step 1: Import helpers** — add `displayText, displayToRawPos, rawToDisplayPos` to the existing `./mention` import (ChatInput.tsx:30–40). Add `FileText` to the lucide import (already imported).
- [ ] **Step 2: Derive display value**

```tsx
// after `const { t } = useI18n();`
const displayValue = useMemo(() => displayText(input), [input]);
```

- [ ] **Step 3: Textarea binds display; onChange edits raw**

- Bind `<textarea ... value={displayValue} />` (currently `value={input}` at ChatInput.tsx:885).
- Replace the top of `handleInputChange` (ChatInput.tsx:432–437) with raw-space splicing:

```tsx
const el = e.target;
const dStart = el.selectionStart ?? displayValue.length;
const dEnd = el.selectionEnd ?? dStart;
const rStart = displayToRawPos(input, dStart);
const rEnd = displayToRawPos(input, dEnd);
const next = input.slice(0, rStart) + e.target.value.slice(dStart, dEnd) + input.slice(rEnd);
setInput(next);
updateMentionFor(next, rStart + (e.target.value.slice(dStart, dEnd).length));
```

- [ ] **Step 4: Caret reads in raw space**

- Backspace tag-delete handler (ChatInput.tsx:484): `const caret = displayToRawPos(input, inputRef.current?.selectionStart ?? input.length);`
- `insertMention` (ChatInput.tsx:603–623): caret read becomes `displayToRawPos(input, el?.selectionStart ?? input.length)`; the final `setSelectionRange` uses `rawToDisplayPos(next, pos)`.
- `updateMentionFor` calls in both handlers pass raw offsets as before (they already operate on raw `next`).

- [ ] **Step 5: Chip row above the textarea** — render before the textarea (ChatInput.tsx:855 area), after the attachment strip block:

```tsx
{parseTags(input).length > 0 && (
  <div className="chat-mention-tag-row">
    {parseTags(input).map((tag) => (
      <div key={tag.path} className="chat-mention-tag" title={tag.path}>
        {tag.path.endsWith("/") ? <FolderOpen size={12} /> : <FileText size={12} />}
        <span className="chat-mention-tag-name">{truncatePath(tag.name, 16, 40)}</span>
        <button
          type="button"
          className="chat-mention-tag-remove"
          onClick={() => {
            const next = input.slice(0, tag.start) + input.slice(tag.end);
            setInput(next);
            setMentionOpen(false);
          }}
          aria-label="Remove file"
        >
          <X size={10} />
        </button>
      </div>
    ))}
  </div>
)}
```

(`X` and `FolderOpen` are already imported; `truncatePath` already imported.)

- [ ] **Step 6: CSS** — add to main.css (mirror attachment-chip styles):

```css
.chat-mention-tag-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 0; }
.chat-mention-tag { display: inline-flex; align-items: center; gap: 4px; max-width: 280px;
  background: var(--color-bg-tertiary, #2a2d35); border: 1px solid #3a3f4b; border-radius: 6px;
  padding: 2px 6px; font-size: 12px; cursor: default; }
.chat-mention-tag-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-mention-tag-remove { border: none; background: none; color: inherit; opacity: .6; cursor: pointer; padding: 0 2px; display: flex; }
.chat-mention-tag-remove:hover { opacity: 1; }
```

- [ ] **Step 7: Verify** — `npx vitest run src/renderer/src/screens/Chat/mention.test.ts` (35 pass) + `npx tsc --noEmit` clean.
- [ ] **Step 8: Commit** `feat(chat): mention tags render as removable badges`

### Task 3: session-context-folder-store — array roots + migration

**Files:**
- Modify: `src/main/session-context-folder-store.ts`

- [ ] **Step 1: New table + migration read**

Add `TABLE_ROOTS = "desktop_session_context_folder_roots"` and `ensureRootsTable` (`session_id TEXT, folder_path TEXT, position INTEGER, updated_at REAL, PRIMARY KEY (session_id, folder_path)`).

- [ ] **Step 2: Array API**

```ts
export function setSessionContextFolders(sessionId: string, folders: string[]): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);
  ensureRootsTable(db);
  db.prepare(`DELETE FROM ${TABLE_ROOTS} WHERE session_id = ?`).run(sessionId);
  folders
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .forEach((f, i) => {
      db.prepare(
        `INSERT INTO ${TABLE_ROOTS} (session_id, folder_path, position, updated_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))
         ON CONFLICT(session_id, folder_path) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
      ).run(sessionId, f, i);
    });
  if (folders.length === 0) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
}

/** Read roots for a session; lazily migrates the legacy single-folder row. */
export function getSessionContextFoldersForSession(sessionId: string): string[] {
  if (!sessionId) return [];
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  ensureRootsTable(db);
  const rows = db
    .prepare(`SELECT folder_path FROM ${TABLE_ROOTS} WHERE session_id = ? ORDER BY position ASC`)
    .all(sessionId) as Array<{ folder_path: string }>;
  const roots = rows.map((r) => r.folder_path);
  if (roots.length === 0) {
    const legacy = getSessionContextFolder(sessionId);
    if (legacy) setSessionContextFolders(sessionId, [legacy]);
  }
  return roots;
}
```

- [ ] **Step 3: Batch read** — change `getSessionContextFolders(sessionIds)` to `Map<string, string[]>`: same chunked IN query against `TABLE_ROOTS`, `ORDER BY position`, group into arrays; sessions missing from roots fall back to legacy row via one extra query (only for the missing ones).

- [ ] **Step 4: Recent list** — `getRecentSessionContextFolders`: query `TABLE_ROOTS` GROUP BY folder_path ORDER BY MAX(updated_at) DESC, and UNION legacy table rows (`UNION ALL` on `SELECT folder_path ... GROUP BY ...`), dedupe in JS preserving recency order.

- [ ] **Step 5: Delete** — `deleteSessionContextFolderForSession` also deletes from `TABLE_ROOTS` when `ensureRootsTable` present (guard with table existence check like `tableExists`).

- [ ] **Step 6: Run existing tests + typecheck**, commit `feat(main): multi-root session context folder store`
- [ ] **Step 7: Follow-up check** — grep remaining `getSessionContextFolder(`/`setSessionContextFolder(` callers (session-cache.ts:112–115, register.ts:2021–2031) and update them; `session-cache.ts` `CachedSession.contextFolder` → `contextFolders: string[]` (hydrated from the batch map). Update `SidebarRecentSessions.tsx`/preload `listCachedSessions` mapping (preload/index.ts:1085–1110, index.d.ts:812–823) accordingly.

### Task 4: IPC + preload + d.ts widening

**Files:**
- Modify: `src/main/ipc/register.ts` (2021–2051, 2786–2790; + new reveal-in-explorer)
- Modify: `src/preload/index.ts` (~871–881, 1508–1529, 515/526)
- Modify: `src/preload/index.d.ts` (~442, ~810–825)

- [ ] **Step 1: Context-folder channels widen to arrays**

`get-session-context-folder` → `getSessionContextFoldersForSession(sessionId)` (returns `string[]`); `set-session-context-folder` → accepts `(sessionId, folders: string[])` → `setSessionContextFolders`.

- [ ] **Step 2: Multi-select dialog**

`select-folder` (register.ts:2786–2790): add `"multiSelections"` to `properties`, return `string[]` (openDialog result `.filePaths`). Update preload + d.ts signature: `selectFolder(): Promise<string[]>`.

- [ ] **Step 3: reveal-in-explorer**

```ts
ipcMain.handle("reveal-in-explorer", (_event, filePath: string) => {
  if (!filePath) return false;
  const { shell } = require("electron");
  try {
    shell.openPath(filePath);
    return true;
  } catch {
    return false;
  }
});
```

(Use the existing top-level `shell` import if present; else `import { shell } from "electron"` at the top of register.ts — check how other handlers import it.)

- [ ] **Step 4: preload + d.ts** — expose `revealInExplorer(path): Promise<boolean>`; widen `selectFolder` return to `string[]`; widen context-folder channels; preload `sendMessage` (index.ts:515, 526) `contextFolder?: string` → `contextFolders?: string[]` (and d.ts:442).
- [ ] **Step 5: typecheck**, commit `feat(ipc): multi-root context folders + reveal in explorer`

### Task 5: Chat.tsx + ContextFolderChip — multi-root state

**Files:**
- Modify: `src/renderer/src/screens/Chat/Chat.tsx` (190–234, 799–841, 1024–1100, 607/720 send-message call sites)
- Modify: `src/renderer/src/screens/Chat/ContextFolderChip.tsx`

- [ ] **Step 1: Chat.tsx state** — `contextFolder` → `contextFolders: string[]` (initial `[]`); restore effect: `getSessionContextFolder` returns array → `setContextFolders(folders)`; persist effect: `setSessionContextFolder(hermesSessionId, contextFolders)`; deps `[hermesSessionId, contextFolders]`.
- [ ] **Step 2: Handlers**

```ts
const handlePickFolder = useCallback(async () => {
  if (remoteMode) { setFolderPickerOpen(true); return; }
  const paths = await window.hermesAPI.selectFolder();
  if (paths && paths.length > 0) {
    setContextFolders((prev) => Array.from(new Set([...prev, ...paths])));
  }
}, [remoteMode]);

const handleRemoveFolder = useCallback((path: string) => {
  setContextFolders((prev) => prev.filter((p) => p !== path));
}, []);

const handleSelectRecentFolder = useCallback((path: string) => {
  setContextFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
}, []);
```

- [ ] **Step 3: send-message** — the two call sites (Chat.tsx:607, 720) pass `contextFolder` → pass `contextFolders`. Follow into `sendMessageViaBestApi`/`sendMessage` signatures (preload 515, register.ts 1465/1601, hermes.ts 1211/1622/1902/2643/2682) — widen parameter to `contextFolders?: string[]`; `contextFolderSystemMessage(contextFolders?: string[])` (hermes.ts:1173–1237) lists every root; `cwd` (hermes.ts:2184) = `contextFolders[0] ?? process.cwd()`. Inline-blur chain (register.ts:1601) passes the array through.
- [ ] **Step 4: WorktreePanel render** (Chat.tsx:1024–1026): `{contextFolders.length > 0 && worktreeVisible && <WorktreePanel folderPaths={contextFolders} />}`.
- [ ] **Step 5: ContextFolderChip** — props change to `contextFolders: string[]`, `onRemoveFolder: (path: string) => void` (replaces `onClearFolder`), `onPickFolder`, `onSelectRecentFolder` (append). Render one chip per root in `.chat-ctxfolder-group`, each with its own X; dropdown item `isSelected` = `contextFolders.includes(path)` (active row still lets you re-add). Add an "Add another..." button next to the chips when `contextFolders.length > 0` (opens the same dropdown / picker).
- [ ] **Step 6: RemoteFolderPicker** (Chat.tsx:1143 `initialPath={contextFolder}`) — keep `initialPath={contextFolders[0] ?? null}`.
- [ ] **Step 7: typecheck**, commit `feat(chat): multi-root folder selection`

### Task 6: WorktreePanel — multi-root, collapsible roots, context menu, search

**Files:**
- Modify: `src/renderer/src/screens/Chat/WorktreePanel.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Props** — `folderPaths: string[]` (was `folderPath: string`).
- [ ] **Step 2: Root headers** — for each root render a `RootSection` header row: chevron + `Folder` icon + name + terminal button (moved from the single header). Each root's tree lives under a collapsible root header (new `rootExpanded` state per path in a `Record<string, boolean>`). Default expanded. Reuse existing `TreeItem` with `parentPath={root}` `depth={0}`.
- [ ] **Step 3: Per-root load** — keep the existing load effect but keyed per root (load each root's `entries` into `Record<string, FileEntry[] | null>`). `refreshVersion` bump on any watcher event (watch each root in the watch effect, dedupe).
- [ ] **Step 4: Folder context menu** — in `TreeItem`, add `onContextMenu` on the row for directories: `e.preventDefault(); onOpenMenu?.(fullPath, e.clientX, e.clientY)`. Panel renders a fixed-position menu at (x, y) with two items: "Open in Explorer" → `window.hermesAPI.revealInExplorer(path)`; "Open in Terminal" → `window.hermesAPI.openTerminal(path)` (reuse `handleOpenTerminal`, generalize to take a path). Close on outside mousedown / Escape / scroll.
- [ ] **Step 5: Search** — search input row at panel top (icon + input, `.worktree-search`). State `searchQuery`; debounce 200ms. When non-empty: `Promise.all(folderPaths.map((p) => window.hermesAPI.listFilesRecursive(p)))`, flatten, `rankMentions(searchQuery, flat, false)` (import from `./mention`), render `.slice(0, 50)` as rows (FileIcon + `truncatePath(name)` + title=path), click → `setSelectedFile(path)`. When empty: normal tree.
- [ ] **Step 6: CSS** — `.worktree-search`, `.worktree-root-header`, `.worktree-context-menu` (+ item/divider styles), reuse `.worktree-row` look.
- [ ] **Step 7: ChatInput.loadMentionEntries** (ChatInput.tsx:548–595) — `getSessionContextFolder` now returns `string[]`; walk every root via `listFilesRecursive`, merging with a combined 10k cap; per-root `readDirectory` fallback when a root returns null; hint row when no roots. (Remote mode unchanged.)
- [ ] **Step 8: typecheck + Chat suite**, commit `feat(chat): multi-root worktree with search and context menu`

### Task 7: terminal-launcher — kill the first-click delay

**Files:**
- Modify: `src/main/terminal-launcher.ts`
- (Optional) `src/main/index.ts` or wherever app-ready hook lives for the warm call

- [ ] **Step 1: Cache failures too** — in `defaultWindowsPackageInstallLocationsAsync` (92–109) remove the `if (locations.length === 0) windowsPackageLocationCache.delete(cacheKey)` line, so a failed probe is cached and never re-run (plus add a `windowsPackageProbeState` set so the pre-warm doesn't double-start).

- [ ] **Step 2: Parallel probes** — in `resolveWindowsTerminalAsync` (427–510), replace the sequential `await findTrustedWindowsPackageExecutableAsync(...)` chain with `Promise.all` over the three package probes, then check pwsh static paths → package pwsh → WT → WT Preview → powershell fallback (existing order, but probes already resolved in parallel).

- [ ] **Step 3: Shorter timeout** — `queryWindowsPackageInstallLocations` timeout 3000 → 1500.

- [ ] **Step 4: Pre-warm** — export `warmTerminalResolver(): void { void resolveTerminalCommandAsync(process.cwd()); }`; call it once shortly after app ready (in the main entry, alongside existing startup work; guard `process.platform === "win32"`).

- [ ] **Step 5: Tests** — run the terminal-launcher tests (`npx vitest run src/main` — confirm path), fix any that assumed the cache-eviction behavior. Add a test: second resolve with injected failing package-locations fn returns cached `[]` without calling the fn again (the injected fn counts calls).
- [ ] **Step 6: Commit** `perf(terminal): parallel cached Appx probes + startup warm`

### Task 8: Full verification + patch + build + push

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green (or pre-existing known failures only)
- [ ] Regenerate `C:\Users\riand\Documents\mention-feature.patch` from `git diff` vs HEAD (9 original files + WorktreePanel + Chat.tsx + ContextFolderChip + session-context-folder-store.ts + terminal-launcher.ts + main.css + ChatInput.tsx + mention.ts + mention.test.ts + new/changed files; use `git add -N` for untracked new files first)
- [ ] Round-trip verify: `git checkout --` changed files + delete untracked, `git apply` patch, typecheck
- [ ] `npm run build` + `npx electron-builder --win --config.directories.output=dist2`
- [ ] Verify dist2 artifacts sized normally (~147MB)
- [ ] Commit + push to fork `custom` branch (user approves)
- [ ] Update AGENTS.md lat.md sections if the repo convention demands (mention-feature already lacks them — keep consistent, note in PR)
