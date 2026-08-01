# Global Knowledge Management Design Specification

## Overview

A built-in **Knowledge Management** system for Hermes Desktop that persists developer guidelines, UI preferences, and past bug fixes across chat sessions and models. Knowledge bundles live globally in `~/.hermes/knowledge/` so they can be attached to any session regardless of workspace.

---

## 1. Left Sidebar Navigation
- **Location**: Top-level item in the left sidebar, placed in `PINNED_NAV_ITEMS` immediately below `schedules` in `src/renderer/src/screens/Layout/Layout.tsx`.
- **Icon**: `BookOpen` from `lucide-react` / `assets/icons`.
- **Locale Key**: `navigation.knowledge` ("Knowledge").
- **View Identifier**: `"knowledge"`.

---

## 2. File Storage & Structure
- **Root Storage Directory**: `~/.hermes/knowledge/` (managed by the Electron main process).
- **Bundle Format**: Each Knowledge entry is a subfolder (e.g. `~/.hermes/knowledge/ui-style-guide/`).
- **Files**: Contains `.md`, `.txt`, `.json`, or code files detailing guidelines, rules, or past mistakes.
- **Main Process IPC APIs (`src/main/ipc/register.ts`)**:
  - `list-knowledge-bundles`: Scans `~/.hermes/knowledge/` and returns list of bundles and nested file objects `{ name, path, isDirectory }`.
  - `create-knowledge-bundle`: Creates a new bundle folder under `~/.hermes/knowledge/<bundle-name>`.
  - `delete-knowledge-bundle`: Deletes a bundle folder.
  - `import-knowledge-folder`: Copies external files/folder into `~/.hermes/knowledge/<bundle-name>/`.
  - `read-knowledge-file`: Reads file content for the editor.
  - `write-knowledge-file`: Saves edits back to disk.
  - `delete-knowledge-file`: Removes a file from a bundle.

---

## 3. Knowledge Management View (`KnowledgeScreen.tsx`)
- **Split-Pane Layout**:
  - **Left Pane (Bundles & Files Tree)**:
    - Lists all global Knowledge bundles.
    - Top bar: `+ New Bundle`, `Import Folder`.
    - Items: Hover/context menu with **Copy Path**, **Copy `@` Tag** (copies `@knowledge/bundle/file.md` to clipboard for instant attachment/mention), `Attach to Session`, `Delete`.
  - **Right Pane (Markdown Editor)**:
    - Integrated Markdown viewer and editor (`textarea` with live preview toggle) for instant editing.

---

## 4. Session Attachment & Chat Integration
- Attached Knowledge bundles appear as distinct chips in `ContextFolderChip` or a dedicated chip row in `Chat.tsx`.
- The session state saves attached bundle names in `attachedKnowledgeBundles: string[]`.

---

## 5. Token Efficiency & Prompt Assembly
- **System Prompt Overhead**: ~300–500 tokens max (index-only).
- **Injected Structure**:
  ```markdown
  === ATTACHED KNOWLEDGE BUNDLES ===
  Bundle: UI Style Guide (~/.hermes/knowledge/ui-style-guide)
  Files:
    - components.md: Design system rules and color variables
    - anti-patterns.md: Mistakes to avoid in React UI
  Instruction: Adhere to guidelines in attached knowledge. Read full files via file tools when needed. Update files if instructed by user to save new preferences or bug fixes.
  ```
- **Tool Access**: Because full file paths are provided, the model can read or update files as needed via standard read/write file tools without bloating every user message turn.
