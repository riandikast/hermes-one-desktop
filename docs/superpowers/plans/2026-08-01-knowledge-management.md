# Knowledge Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global Knowledge Management system in Hermes Desktop (`~/.hermes/knowledge/`), accessible from the left sidebar under Schedules, supporting session attachments and lightweight prompt indexing.

**Architecture:** Create `src/main/knowledge.ts` to manage global bundle directories and files. Expose IPC endpoints in `register.ts` and `preload`. Add `"knowledge"` view in `Layout.tsx` with a `BookOpen` nav item below `schedules`. Build `KnowledgeScreen.tsx` split-pane UI with bundle/file manager, single-click Copy Path/Tag, Markdown editor, and session attachment.

**Tech Stack:** TypeScript, React, Electron IPC, Node `fs/promises`, Vitest.

---

### Task 1: Main Process Knowledge Store & IPC Handlers

**Files:**
- Create: `src/main/knowledge.ts`
- Create: `src/main/knowledge.test.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts` and `src/preload/index.d.ts`

- [ ] **Step 1: Write failing unit tests for knowledge store**

Create `src/main/knowledge.test.ts` to test bundle creation, file listing, file reading/writing, and bundle deletion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/knowledge.test.ts`

- [ ] **Step 3: Implement `src/main/knowledge.ts`**

Implement `getKnowledgeDir`, `listKnowledgeBundles`, `createKnowledgeBundle`, `deleteKnowledgeBundle`, `readKnowledgeFile`, `writeKnowledgeFile`, `deleteKnowledgeFile`, and `importKnowledgeFolder`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Register IPC handlers and Preload methods**

Register `list-knowledge-bundles`, `create-knowledge-bundle`, `delete-knowledge-bundle`, `read-knowledge-file`, `write-knowledge-file`, `delete-knowledge-file`, `import-knowledge-folder` in `src/main/ipc/register.ts` and expose via `src/preload/index.ts` / `index.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/main/knowledge.ts src/main/knowledge.test.ts src/main/ipc/register.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(knowledge): add main process storage and IPC handlers for global knowledge bundles"
```

---

### Task 2: Left Sidebar Navigation & Knowledge Screen UI

**Files:**
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Create: `src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx`
- Create: `src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx`
- Modify: `src/shared/i18n/locales/en/navigation.ts`

- [ ] **Step 1: Write failing test for KnowledgeScreen UI**

Create `src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx` verifying bundle list rendering and file select/editing.

- [ ] **Step 2: Implement KnowledgeScreen split-pane UI**

Build `KnowledgeScreen.tsx` with:
- Left pane: Knowledge bundle tree, `+ New Bundle`, `Import Folder`, hover actions (`Copy Path`, `Copy @ Tag`, `Delete`).
- Right pane: Integrated Markdown editor/viewer for selected file.

- [ ] **Step 3: Add Knowledge view to Left Sidebar in Layout.tsx**

Add `{ view: "knowledge", icon: BookOpen, labelKey: "navigation.knowledge" }` under `schedules` in `PINNED_NAV_ITEMS` in `Layout.tsx`. Add `knowledge` key to `en/navigation.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Layout/Layout.tsx src/renderer/src/screens/Knowledge/KnowledgeScreen.tsx src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx src/shared/i18n/locales/en/navigation.ts
git commit -m "feat(knowledge): add sidebar nav item and Knowledge management split-pane screen"
```

---

### Task 3: Session Attachment & Prompt Index Injection

**Files:**
- Modify: `src/renderer/src/screens/Chat/ContextFolderChip.tsx`
- Modify: `src/renderer/src/screens/Chat/Chat.tsx`
- Modify: `src/main/ipc/register.ts` or prompt assembly handler

- [ ] **Step 1: Add Knowledge Bundle Chips to Chat Composer**

Allow attaching global knowledge bundles to the chat session alongside workspace context folders in `ContextFolderChip.tsx` / `Chat.tsx`.

- [ ] **Step 2: Inject Knowledge Index in Prompt Assembly**

Format attached knowledge bundles into a lightweight index (~300-500 tokens) in the system prompt instructing the model to reference/update files via file tools when needed.

- [ ] **Step 3: Run Vitest test suite**

Run: `npx vitest run src/main/knowledge.test.ts src/renderer/src/screens/Knowledge/KnowledgeScreen.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Chat/ContextFolderChip.tsx src/renderer/src/screens/Chat/Chat.tsx src/main/ipc/register.ts
git commit -m "feat(knowledge): support session knowledge bundle attachment and system prompt index injection"
```

---

### Task 4: Full Verification and Build

- [ ] **Step 1: Run full vitest suite**

Run: `npx vitest run`

- [ ] **Step 2: Build project**

Run: `npm run build`

- [ ] **Step 3: Build portable package**

Run: `npx electron-builder --win portable --x64`

- [ ] **Step 4: Push branch**

Run: `git push fork custom`
