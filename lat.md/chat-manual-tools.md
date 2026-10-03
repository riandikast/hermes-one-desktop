# Manual chat tools

Chat offers saved command execution in its floating terminal and a database history refresh beside the persisted message count, without restarting the agent or remounting the composer.

## Command templates

Type a standalone @ on an empty terminal input line to open all Commands templates. Search, arrow keys, Enter, click, Escape and Cancel use the existing completion surface. Only explicit selection executes.

The picker writes the exact command to the current terminal, never creating a tab. Main retains its shell kind and quotes an optional saved cwd; blank or absent cwd leaves the current directory unchanged. Opening and cancelling do not execute. Failed writes allow retry.

PowerShell uses literal paths, POSIX shells quote apostrophes, and cmd uses cd /d across drives. Control characters in cwd and cmd expansion characters are rejected rather than interpreted. Focused terminal-session tests use fake PTYs; no user commands execute.

Opening the floating terminal creates one session only if the dock is empty. Creation is single-flight; rerenders do not retry. Reopening after failure permits retry. Closing hides the mounted dock, preserving sessions; never-opened chats create nothing.

Picker names use primary text, directory metadata uses secondary text, and command previews blend primary with the accent for contrast. Selection uses the existing accent-subtle background; keyboard focus has a primary-text outline.

## Session refresh

Refresh reads the current session's full history using existing reconciliation. It preserves drafts and run identity, rejects duplicate requests and stale responses, and waits for streaming or earlier-page loading to finish.

A successful full reload clears earlier-page availability. Failure leaves the existing transcript intact and permits retry. Full reload is user-triggered only; very large histories may take time. No agent restart, tab reopen or context mutation occurs.

## Focused verification

TerminalDock.complete.test.tsx drives mocked xterm input, verifying listing, explicit execution with saved cwd, cancellation and directory completion. No real user command executes.

TerminalDock.newSession.test.tsx verifies empty opening and reopen preservation. chatWiring.test.ts checks real chat props, single-flight creation, retry and dark/light token contrast. useSessionRefresh.test.tsx covers history refresh races and failures.
