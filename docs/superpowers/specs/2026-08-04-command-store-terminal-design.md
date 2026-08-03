# Command Store + Built-in Terminal — Design

Date: 2026-08-04

## Goal

A new pinned sidebar view "Command" that stores reusable terminal commands (name,
multi-line command, description, working directory) and runs them in a built-in
integrated terminal (VS Code style) inside the Command view — never spawning an
external terminal window.

## Decisions (from brainstorming)

- **Run behavior**: Run opens the built-in terminal and auto-runs the command,
  leaving the terminal interactive afterward.
- **Terminal placement**: Inside the Command view (split: commands list on top,
  terminal dock below).
- **Fields per command**: name, multi-line command, description, cwd.
- **Terminal lifecycle**: multiple switchable sessions (tabbed), like VS Code
  terminal tabs.
- **Shell**: auto-detect — Windows: pwsh (PowerShell 7) if resolvable else
  powershell.exe; macOS/Linux: `$SHELL` or `/bin/bash`. Multi-line commands run
  via a temp script file (`.ps1`/`.cmd`/`.sh`).

## Architecture

### Main process

- **`src/main/command-store.ts`** — JSON file store mirroring the Knowledge
  store pattern (`knowledge.ts`): records `{ id, name, command, description,
  cwd, createdAt, updatedAt }`, persisted to a userData JSON file. Functions:
  `listCommands()`, `saveCommand(record)`, `deleteCommand(id)`, `getCommand(id)`.
- **`src/main/terminal-session.ts`** — wraps `node-pty`:
  - `createSession(shell, cwd, cols, rows)` → `{ id, write(data), resize(cols,
    rows), kill() }` plus an event callback for `onData`.
  - Session registry keyed by id so the renderer can address a specific PTY.
  - Shell resolution helper: `resolveShell()` (pwsh → powershell.exe → fallback
    to platform default).
- **`src/main/run-command.ts`** — writes the multi-line command to a temp script
  file in `os.tmpdir()` (`hermes-cmd-<id>.<ext>`), spawns a session whose cwd is
  the command's `cwd` (or fallback), and feeds `& <script-path>` (or platform
  equivalent) into the PTY so it executes and keeps the shell interactive.
  Schedules deletion of the temp script after a grace period.
- **IPC** (`register.ts`): `commands:list`, `commands:save`, `commands:delete`,
  `terminal:create`, `terminal:write`, `terminal:resize`, `terminal:kill`,
  plus `terminal:data` main→renderer broadcast. Preload bridge mirrors these on
  `hermesAPI`.

### Renderer

- **`src/renderer/src/screens/Command/CommandScreen.tsx`** — new pinned view.
  Top: command list (name, description, Run / Edit / Delete), inline editor
  (name input, multi-line textarea for the command, description input, cwd
  picker reusing the existing `selectFolder` IPC).
- **`src/renderer/src/screens/Command/TerminalDock.tsx`** — xterm.js `Terminal`
  instances, one per session. Tab row on top (session tabs, "+" new session,
  close kills PTY), terminal canvas below. Wires xterm `onData` →
  `terminal:write`; `terminal:data` broadcast → `term.write()`. Resize handler
  on container size change → `terminal:resize`.
- **`Layout.tsx`** — add `"commands"` to the `View` union, PINNED_NAV_ITEMS
  entry (icon: `TerminalSquare`), pane render for `visitedViews.has("commands")`,
  label key `navigation.commands` in en locale.

### Data flow

1. User clicks Run on a command → `runCommand(id)` IPC → temp script written →
   `terminal:create` session → script path fed into PTY → output streams back
   via `terminal:data` → xterm renders.
2. User types in xterm → `terminal:write` → node-pty writes to PTY stdin.
3. User resizes the dock → `terminal:resize` → PTY resize → shell reflows.

## Error handling

- Temp script write failure / shell spawn failure → IPC returns `{ ok: false,
  error }`; renderer shows a toast/inline error.
- PTY exits (user types `exit`, process dies) → `onExit` → renderer marks the
  tab dead (X turns into reopen).
- Shell not found → fallback chain before failing.

## Dependencies

- `node-pty` (native module — requires `@electron/rebuild` like better-sqlite3,
  plus npm `allowScripts` entry in package.json for its postinstall).
- `xterm`, `@xterm/addon-fit` (renderer, pure JS).

## Testing

- `command-store.test.ts` — CRUD + persistence (mirror `knowledge.test.ts`).
- `terminal-session.test.ts` — mock node-pty; shell resolution fallback chain;
  run-command temp-script path for `.ps1`/`.cmd`/`.sh` (platform-gated).
- Manual: run a multi-line command, switch sessions, resize, kill session.

## Out of scope

- Per-command shell field.
- Terminal persistence across app restarts.
- Chat tab integration.
