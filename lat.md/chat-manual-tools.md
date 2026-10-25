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

## Floating diagnostic logs

Chat provides a floating log viewer beneath the search icon for troubleshooting runtime crashes and inspecting provider API requests.

The trigger in [[src/renderer/src/screens/Chat/Chat.tsx]] opens [[src/renderer/src/screens/Chat/ChatLogsDialog.tsx#ChatLogsDialog]] with two tabs: Crash & Errors (reading `errors.log`) and Request Log (reading `agent.log`). The Request Log defaults to filtering API call requests and responses with model, provider, tokens, and retry countdowns, while supporting full agent log view and live search filtering.

## Pinned chat bar

The pinned bar sits in the same top row as the floating control rail, to its LEFT, so the two never overlap. The rail starts at `top: 72px`, which leaves room for the speed-dial stack to expand upward.

[[src/renderer/src/screens/Chat/MessageList.tsx#PinnedMessagesBar]] starts COLLAPSED on every mount, showing only the pin-count pill. Expanding it is a user action; the bubbles are not rendered until then.

## Speed-dial FAB

The floating control rail is collapsed behind a single grid-icon FAB (speed-dial pattern). Clicking the FAB expands all tool icons in a vertical animated stack; clicking FAB again or anywhere outside collapses it.

[[src/renderer/src/screens/Chat/SpeedDialFAB.tsx]] wraps any number of `items` (each a React node). It owns open/close state, outside-click dismissal, and Escape handling. CSS keyframe `speed-dial-item-in` staggers item entrance via `--item-index`. No new dependencies added.

### Collapsed by default

The FAB renders collapsed on mount; `aria-expanded` is false and no items are interactive.

### Expands on FAB click

Clicking the FAB button adds `.speed-dial--open` to the wrapper, making items visible and pointer-interactive.

### Collapses on second FAB click

A second FAB click removes `.speed-dial--open`, returning to the collapsed state.

### Escape closes

Pressing Escape while expanded collapses the FAB.

### aria-expanded reflects state

The FAB button's `aria-expanded` attribute tracks the open/closed state accurately.

## On-finish keyboard banner

The legacy banner component is retained for compatibility tests but is no longer mounted in Chat. Configure automatic key delivery through [[chat-on-finish#Existing terminal input]] instead; normal typing is no longer intercepted.

[[src/renderer/src/screens/Chat/OnFinishBanner.tsx]] renders when `visible` is true. It registers a `keydown` listener for Enter/Y (sends `\n`), N/Ctrl+C (sends SIGINT `\x03`), R (re-run queue), and Escape (dismiss). `TerminalDockHandle.getActiveSessionId()` exposes the active session id to the banner. Clicking outside the banner dismisses it via an invisible backdrop.

### Renders when visible

When `visible` is true, the banner shows Continue, Interrupt, and Re-run action buttons.

### Enter sends newline

Pressing Enter (or clicking Continue) writes `\n` to the active terminal session and dismisses the banner.

### N sends SIGINT

Pressing N (or Ctrl+C) writes `\x03` to the active terminal session and dismisses the banner.

### R triggers rerun

Pressing R dismisses the banner and calls `onRerun` without writing to the terminal.

### Escape dismisses

Pressing Escape dismisses the banner without writing to the terminal.

## Focused verification

ChatLogsDialog.test.tsx tests tab switching between errors and requests, request-only line filtering, real-time query matching, copy to clipboard, and modal dismissal.

TerminalDock.complete.test.tsx drives mocked xterm input, verifying listing, explicit execution with saved cwd, cancellation and directory completion. No real user command executes.

TerminalDock.newSession.test.tsx verifies empty opening and reopen preservation. chatWiring.test.ts checks real chat props, single-flight creation, retry and dark/light token contrast. useSessionRefresh.test.tsx covers history refresh races and failures.

chatPanels.speedDial.test.tsx covers SpeedDialFAB collapse/expand/Escape/aria states, and OnFinishBanner keyboard shortcuts (Enter, N, R, Escape), click actions, and visibility.
