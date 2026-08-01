# Terminal Launch, Voidtools Everything & BFS Search Design Specification

## Problem Statement

1. **Terminal Launch**: Direct execution of `WindowsTerminal.exe` inside `C:\Program Files\WindowsApps\` fails with `EACCES` / `EPERM` due to Windows AppX permissions.
2. **File Search Accuracy & Performance**:
   - `list-files-recursive` uses an alphabetical depth-first search (DFS) capped at 10,000 entries. Deep subdirectories alphabetically preceding `src/` hit the cap first, leaving critical project files unindexed.
   - Searching large disk directories in JS freezes/slows the app.

## Solutions

### 1. Terminal Launcher (`src/main/terminal-launcher.ts`)
- On Windows, resolve terminals using reliable executables:
  - `wt.exe` (spawns Windows Terminal via Windows execution alias / PATH or `cmd.exe /c start wt.exe -d "<dirPath>"`)
  - `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (with `cwd: dirPath` and `args: ["-NoExit", "-NoLogo"]`)
  - `%SystemRoot%\System32\cmd.exe` (with `cwd: dirPath`)
- Avoid calling `C:\Program Files\WindowsApps\...` executables directly via `child_process.spawn()`.

### 2. Voidtools Everything Integration (`src/main/everything-search.ts`)
- Check if Voidtools Everything HTTP server is available (`http://127.0.0.1:8080/?search=...&json=1` or custom port if configured) or `es.exe` CLI tool is installed on Windows.
- If Everything is available:
  - Query `http://127.0.0.1:8080/?search=<query>&json=1&path=<rootPath>` with a 500ms timeout.
  - Return instant whole-disk / workspace matching files directly from Everything's index.
- Expose via IPC `everything-search` and integrate defensively into file search fallback.

### 3. Breadth-First Search (BFS) File Walk (`src/main/ipc/register.ts`)
- Replace depth-first recursive walk in `list-files-recursive` with a queue-based Breadth-First Search (BFS) algorithm.
- Scan root files and top-level directory entries first (e.g. `src/`, `lib/`, `app/`) before recursing into deeper subfolders.
- Keep `MENTION_EXCLUDED_DIRS` filter and `MENTION_MAX_ENTRIES` cap, ensuring key code files in root and `src/` are scanned before reaching the cap.
