# Search, Terminal, Project Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file search exact-first and generated-file-resistant, make nested-folder terminal launch reliable, and add frontend-only right-click project renaming.

**Architecture:** Add one pure shared search index/ranker consumed by `ChatInput` and `WorktreePanel`. Keep terminal probing but launch the resolved executable directly with the target directory as `cwd` or Windows Terminal `-d` argument. Store project display aliases in a small renderer-side localStorage helper keyed by normalized folder path.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, localStorage.

---

## File Map

- Create: `src/renderer/src/screens/Chat/fileSearch.ts` — exclusion rules, tokenization, indexing, scoring.
- Test: `src/renderer/src/screens/Chat/fileSearch.test.ts` — pure search behavior.
- Modify: `src/renderer/src/screens/Chat/ChatInput.tsx` — use shared search results for `@` and `@/`.
- Modify: `src/renderer/src/screens/Chat/WorktreePanel.tsx` — use shared search results for sidebar search.
- Modify: `src/main/ipc/register.ts` — validate terminal directory before IPC dispatch if required by the current handler.
- Modify: `src/main/terminal-launcher.ts` — direct nested-directory launch.
- Create: `src/main/terminal-launcher.test.ts` — resolver/argument tests using injected filesystem probes.
- Create: `src/renderer/src/screens/Layout/projectAliases.ts` — normalized-key localStorage helper.
- Create: `src/renderer/src/screens/Layout/projectAliases.test.ts` — alias persistence tests.
- Modify: `src/renderer/src/screens/Layout/SidebarRecentSessions.tsx` — alias lookup and project-header context menu/inline rename.
- Modify: `src/shared/i18n/locales/en/chat.ts` or the appropriate navigation locale file — rename label if no existing key fits.
- Modify: `src/renderer/src/assets/main.css` — project rename input/context menu styles.

### Task 1: Shared Search Engine

**Files:** create `fileSearch.ts`, create `fileSearch.test.ts`.

- [ ] Write failing tests for `isExcludedDirectory`, `tokenizeSearch`, `rankFileEntries`, and `filterSearchEntries`.
- [ ] Cover exact case-insensitive basename with extension, exact relative path, camelCase token match, separator match, generated-folder exclusion, directory/file filtering, depth tie-break, and deterministic path tie-break.
- [ ] Run `npx vitest run src/renderer/src/screens/Chat/fileSearch.test.ts`; expected initial failure because the module does not exist.
- [ ] Implement `EXCLUDED_DIRS` containing `.git`, `.hg`, `.svn`, `.gradle`, `.idea`, `node_modules`, `build`, `out`, `dist`, `target`, `generated`, `coverage`, `.next`, `.cache`, `__pycache__`, `.venv`, and `venv`.
- [ ] Implement `tokenizeSearch(value)` by lowercasing, converting `\\`, `/`, `_`, `-`, `.`, and whitespace to separators, and splitting camelCase boundaries.
- [ ] Implement scoring tiers in this order: exact basename, exact normalized relative path, basename token/prefix, basename substring, path-token fuzzy. Add depth/path-length tie-breaks only after tier score.
- [ ] Return only matching entry kinds; preserve `{ name, isDirectory, path }`.
- [ ] Run the same Vitest command; expected PASS.
- [ ] Commit: `feat(search): add shared exact-first file search engine`.

### Task 2: Wire Both Pickers

**Files:** modify `ChatInput.tsx`, `WorktreePanel.tsx`, test existing mention tests if needed.

- [ ] Replace direct `rankMentions` calls with the shared scorer while preserving `@` file mode and `@/` directory mode.
- [ ] Ensure both components use the same exclusion rules and score function; do not keep a second ranking algorithm.
- [ ] Keep the existing IPC recursive listing shape. Filter excluded paths defensively in the renderer so remote/legacy lists also behave consistently.
- [ ] Keep the current result limits, but ensure exact matches are always included before truncation.
- [ ] Add regression tests proving a real file `MainActivity.kt` outranks generated files such as `build/generated/.../MainActivity.kt` and similar names.
- [ ] Run `npx vitest run src/renderer/src/screens/Chat/fileSearch.test.ts src/renderer/src/screens/Chat/mention.test.ts src/renderer/src/screens/Chat/ChatInput.test.tsx`.
- [ ] Commit: `fix(search): share exact-first ranking across sidebar and mentions`.

### Task 3: Fix Nested Terminal Launch

**Files:** modify `src/main/terminal-launcher.ts`, create `src/main/terminal-launcher.test.ts`, inspect `src/main/ipc/register.ts` only if validation needs adjustment.

- [ ] Add failing resolver tests with injected `exists`, `listDirs`, and package-location functions for nested paths containing spaces, drive roots, and invalid directories.
- [ ] Assert Windows Terminal command uses `command: WindowsTerminal.exe`, `args: ["-d", dirPath]`, and `cwd: dirPath`.
- [ ] Assert PowerShell command uses `cwd: dirPath` and `args: ["-NoExit", "-NoLogo"]` without `/c start /D`.
- [ ] Assert invalid directory returns `false` before spawning.
- [ ] Replace Windows `startCommand` arguments `["/d", "/s", "/c", "start", "", "/D", dirPath, target, ...args]` with `{ command: target, args, cwd: dirPath }`.
- [ ] Preserve executable discovery order and boolean `openTerminalInDirectory` behavior.
- [ ] Run `npx vitest run src/main/terminal-launcher.test.ts`; expected PASS.
- [ ] Run the relevant existing main tests.
- [ ] Commit: `fix(terminal): launch nested folders directly`.

### Task 4: Frontend Project Aliases

**Files:** create `projectAliases.ts`, create `projectAliases.test.ts`, modify `SidebarRecentSessions.tsx`, `main.css`, locale file.

- [ ] Write failing helper tests for normalized Windows/Unix keys, set/read, empty-name reset, malformed localStorage, and storage exceptions.
- [ ] Implement `normalizeProjectPath(path)` with slash normalization and case-folding for drive-letter paths.
- [ ] Implement `getProjectAlias`, `setProjectAlias`, and `projectDisplayName`; store one JSON object under `hermes.sidebar.projectAliases`.
- [ ] Implement the sidebar group name as `projectDisplayName(group.path)` instead of the raw folder basename.
- [ ] Add project-header `onContextMenu` that prevents the browser menu and opens a small local menu with `Rename`.
- [ ] Selecting `Rename` starts inline editing for that group only. Enter saves trimmed text; Escape cancels; empty text restores basename; blur saves.
- [ ] Keep project path/session records unchanged. Refresh alias state after save so all matching groups update immediately.
- [ ] Add the smallest required locale key and CSS for menu/input states.
- [ ] Run `npx vitest run src/renderer/src/screens/Layout/projectAliases.test.ts`.
- [ ] Commit: `feat(sidebar): add frontend-only project aliases`.

### Task 5: Full Verification and Artifact

**Files:** no source changes unless verification finds a defect.

- [ ] Run `npx vitest run src/renderer/src/screens/Chat/fileSearch.test.ts src/renderer/src/screens/Chat/mention.test.ts src/renderer/src/screens/Chat/ChatInput.test.tsx src/renderer/src/screens/Layout/projectAliases.test.ts src/main/terminal-launcher.test.ts`.
- [ ] Run `npm run build`; expected node/web typecheck and electron-vite build success.
- [ ] Run `npx electron-builder --win portable --x64` only after the build succeeds.
- [ ] Keep only `dist2/hermes-desktop-0.7.4-portable.exe`; remove setup, blockmap, metadata, and builder debug artifacts.
- [ ] Extract `dist/win-unpacked/resources/app.asar` with `asar.extractAll` and verify markers for shared search, direct terminal launch, project aliases, and `Rename`.
- [ ] Inspect `git status`, `git diff`, and `git log --oneline -10`; commit only intended files.
- [ ] Push `custom` to `fork`.

## Self-Review

- Search requirements map to Tasks 1–2.
- Terminal requirements map to Task 3.
- Frontend-only right-click rename maps to Task 4.
- Error handling and tests map to every task and Task 5.
- No backend schema, content search, or new dependency is introduced.
