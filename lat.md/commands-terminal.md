# Commands store + built-in terminal

A pinned "Commands" view stores reusable terminal commands (name, multi-line
command, description, working directory) and runs them in a built-in
integrated terminal dock — no external terminal windows.

[[src/main/command-store.ts]] persists records to `commands.json` under
`HERMES_HOME` (or `~/.hermes`) with CRUD over IPC (`commands:list` /
`commands:save` / `commands:delete`).

## Search, folders, and drag-to-group

Commands are searchable and grouped under collapsible folders; rows drag onto a folder header to move.

[[src/renderer/src/screens/Command/CommandScreen.tsx]] filters the list by
name/description/command as you type. Each command carries a `folder` string
(empty = ungrouped); the list groups commands under collapsible folder
headers. Command rows are draggable — dropping a row on a folder header moves
it into that folder (saved via `commands:save`). The editor's Folder dropdown
lists existing folders plus "＋ New folder…" which reveals an inline name
input.

## Resizable terminal dock

The dock height defaults to 260px and is adjustable by dragging the
`.terminal-dock-resize` handle between the list and the dock (VS Code style,
120–640px clamp). The height persists in localStorage under
`hermes.commands.terminalHeight`.

## Built-in terminal

node-pty spawns the detected shell; multi-line commands run via temp scripts so the shell stays interactive.

[[src/main/terminal-session.ts]] wraps node-pty: `createTerminalSession` spawns
the detected shell (PowerShell 7 if present, else Windows PowerShell on win32;
`$SHELL` or `/bin/bash` elsewhere) and keeps a registry keyed by session id.
[[src/main/run-command.ts]] writes multi-line commands to a temp script
(`.ps1`/`.cmd`/`.sh`, UTF-8 BOM for pwsh so Windows PowerShell 5.1 reads
non-ASCII) and the session feeds `& '<script>'` / `call "<script>"` /
`. '<script>'` into the PTY so the command runs and the shell stays
interactive. Temp scripts are deleted after a 60s grace period.

[[src/renderer/src/screens/Command/TerminalDock.tsx]] renders one xterm.js
terminal per session with tabbed switching, wired via `terminal:create` /
`terminal:write` / `terminal:resize` / `terminal:kill` and the main→renderer
`terminal:data` / `terminal:exit` broadcasts. [[src/renderer/src/screens/Command/CommandScreen.tsx]]
hosts the list + inline editor above the dock; Run calls `command:run`, which
creates a session and auto-executes the command.

## Note on native modules

`node-pty` needs the Electron rebuild, like better-sqlite3.

It must be rebuilt after Electron updates via
`npx @electron/rebuild -f -w node-pty`, and its postinstall is whitelisted in
package.json `allowScripts` (npm 11 script gate).
