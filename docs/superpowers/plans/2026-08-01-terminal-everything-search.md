# Terminal Launch, Voidtools Everything & BFS Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Windows terminal launching via `wt.exe` / `powershell.exe`, integrate Voidtools Everything for instant Windows file search, and replace DFS file scanning with BFS to ensure key project files are indexed.

**Architecture:** Update `terminal-launcher.ts` to spawn `wt.exe` or `powershell.exe` without calling `WindowsApps` direct paths. Create `everything-search.ts` to query Voidtools Everything HTTP API (`http://127.0.0.1:8080`) when active. Update `list-files-recursive` in `register.ts` to use a queue-based Breadth-First Search (BFS) walk.

**Tech Stack:** TypeScript, Electron IPC, Node.js `http`/`child_process`/`fs`, Vitest.

---

### Task 1: Fix Terminal Launcher Execution Paths

**Files:**
- Modify: `src/main/terminal-launcher.ts`
- Modify: `src/main/terminal-launcher.test.ts`

- [ ] **Step 1: Write failing test for wt.exe and powershell fallback**

Update `src/main/terminal-launcher.test.ts` to test that Windows terminal resolution returns `wt.exe` or `powershell.exe` in `System32` instead of `WindowsApps` direct executable paths.

```typescript
it("resolves wt.exe or System32 powershell on windows without WindowsApps path", async () => {
  const result = await resolveTerminalCommandAsync("C:\\tmp\\hd", {
    platform: "win32",
    env: { SystemDrive: "C:", SystemRoot: "C:\\Windows" },
    exists: (p) => p.endsWith("powershell.exe") || p.endsWith("cmd.exe"),
  });
  expect(result).not.toBeNull();
  expect(result?.command).not.toContain("WindowsApps");
});
```

- [ ] **Step 2: Run test to verify it fails if WindowsApps is targeted**

Run: `npx vitest run src/main/terminal-launcher.test.ts`
Expected: Test runs and verifies executable paths.

- [ ] **Step 3: Modify terminal-launcher.ts to use wt.exe / powershell.exe**

Update `src/main/terminal-launcher.ts` to resolve `wt.exe` or `System32\WindowsPowerShell\v1.0\powershell.exe` directly instead of looking inside `Program Files\WindowsApps`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/terminal-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal-launcher.ts src/main/terminal-launcher.test.ts
git commit -m "fix(terminal): resolve wt.exe or powershell without WindowsApps ACL restriction"
```

---

### Task 2: Implement Voidtools Everything Integration

**Files:**
- Create: `src/main/everything-search.ts`
- Create: `src/main/everything-search.test.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts` and `src/preload/index.d.ts`

- [ ] **Step 1: Create everything-search.ts helper**

Implement `queryEverything(searchQuery: string, options?: { port?: number; timeoutMs?: number })` querying `http://127.0.0.1:8080/?search=...&json=1` via Node.js `http` module.

- [ ] **Step 2: Write failing unit tests for queryEverything**

Create `src/main/everything-search.test.ts` to test Everything API parsing and connection failure fallback handling.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/main/everything-search.test.ts`
Expected: PASS

- [ ] **Step 4: Register IPC handler for everything-search**

In `src/main/ipc/register.ts`, register `everything-search` IPC handler to allow renderer to query Everything when enabled.

- [ ] **Step 5: Commit**

```bash
git add src/main/everything-search.ts src/main/everything-search.test.ts src/main/ipc/register.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(search): add Voidtools Everything integration for Windows file search"
```

---

### Task 3: BFS File Walk for list-files-recursive

**Files:**
- Modify: `src/main/ipc/register.ts`
- Modify: `src/renderer/src/screens/Chat/fileSearch.test.ts`

- [ ] **Step 1: Write test verifying BFS prioritizes top-level/src directories over deep alphabetical folders**

Add test to `src/renderer/src/screens/Chat/fileSearch.test.ts` or main IPC test.

- [ ] **Step 2: Update list-files-recursive to use queue-based Breadth-First Search (BFS)**

In `src/main/ipc/register.ts`, rewrite `list-files-recursive` handler using a queue `[{ dir: root, rel: "" }]` so root files and shallow subfolders (`src/`, `lib/`, etc.) are processed before deep subdirectories.

- [ ] **Step 3: Run tests to verify pass**

Run: `npx vitest run src/renderer/src/screens/Chat/fileSearch.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/register.ts
git commit -m "fix(search): switch list-files-recursive to BFS walk to prioritize src and root files"
```

---

### Task 4: Full Verification and Build

**Files:**
- Run full vitest suite, `npm run build`, and electron-builder portable packaging.

- [ ] **Step 1: Run vitest test suite**

Run: `npx vitest run src/main/terminal-launcher.test.ts src/main/everything-search.test.ts src/renderer/src/screens/Chat/fileSearch.test.ts`

- [ ] **Step 2: Run npm run build**

Run: `npm run build`

- [ ] **Step 3: Build portable binary**

Run: `npx electron-builder --win portable --x64`

- [ ] **Step 4: Push changes**

Run: `git push fork custom`
