# Manual chat tools

Chat offers saved command execution in its floating terminal and a database history refresh beside the persisted message count, without restarting the agent or remounting the composer.

## Command templates

Type a standalone @ on an empty terminal input line to open all Commands templates. Search, arrow keys, Enter, click, Escape and Cancel use the existing completion surface. Only explicit selection executes.

The picker writes the exact command to the current terminal, never creating a tab. Main retains its shell kind and quotes an optional saved cwd; blank or absent cwd leaves the current directory unchanged. Opening and cancelling do not execute. Failed writes allow retry.

PowerShell uses literal paths, POSIX shells quote apostrophes, and cmd uses cd /d across drives. Control characters in cwd and cmd expansion characters are rejected rather than interpreted. Focused terminal-session tests use fake PTYs; no user commands execute.

The chat toolbar Terminal button sits between the folder and Git controls. Clicking it or pressing Ctrl/Cmd+T toggles the retained terminal dialog. Opening creates one session only if the dock is empty. Creation is single-flight; rerenders do not retry. Reopening after failure permits retry. Closing hides the mounted dock, preserving sessions; never-opened chats create nothing.

Picker names use primary text, directory metadata uses secondary text, and command previews blend primary with the accent for contrast. Selection uses the existing accent-subtle background; keyboard focus has a primary-text outline.

## Session refresh

Refresh reads the current session's full history using existing reconciliation. It preserves drafts and run identity, rejects duplicate requests and stale responses, and waits for streaming or earlier-page loading to finish.

A successful full reload clears earlier-page availability. Failure leaves the existing transcript intact and permits retry. Full reload is user-triggered only; very large histories may take time. No agent restart, tab reopen or context mutation occurs.

## Floating diagnostic logs

Chat provides a floating log viewer beneath the search icon for troubleshooting runtime crashes and inspecting provider API requests.

The trigger in [[src/renderer/src/screens/Chat/Chat.tsx]] opens [[src/renderer/src/screens/Chat/ChatLogsDialog.tsx#ChatLogsDialog]] with two tabs: Crash & Errors (reading `errors.log`) and Request Log (reading `agent.log`). The Request Log defaults to filtering API call requests and responses with model, provider, tokens, and retry countdowns, while supporting full agent log view and live search filtering.

## Android Logcat

The floating phone icon opens a local Android device log viewer without requiring a workspace or launching an app. Capture starts only after explicit Start; closing the panel or leaving the chat stops its reader.

[[src/renderer/src/screens/Chat/AndroidLogcat.tsx#AndroidLogcat]] uses the shared two-corner resizable dialog. It lists ready, offline and unauthorized devices, supports refresh, Start/Stop, Pause/Resume, literal text/tag/PID filtering, minimum severity and Follow. Clear view only clears the renderer, never the phone's buffers. USB debugging and phone authorization are prerequisites. Device logs stay in memory and are never injected into chat automatically.

[[src/main/android-logcat.ts#listAndroidDevices]] discovers SDK Platform-Tools through ANDROID_HOME, ANDROID_SDK_ROOT, the standard Windows SDK folder, then PATH. [[src/main/android-logcat.ts#startAndroidLogcat]] spawns shell-free `adb -s SERIAL logcat -v threadtime -T 500`: uppercase -T includes recent buffered rows and continues streaming (lowercase -t would exit). The UTF-8 decoder preserves split characters. Retention is bounded to 2000 lines, 4096 characters per line and four owned processes; snapshots and visible DOM rows are capped at 500. The renderer polls sequentially every 500ms only while unpaused. Old rows can be dropped during high log volume or a long pause.

Main-frame IPC checks and per-webContents capture ownership prevent other renderers from reading/stopping captures. Unmount, late-start replies, renderer destruction, crash and navigation clean up owned readers only. Never run adb kill-server, clear phone logs, launch an app or alter device privileges. Main/preload changes require a user-controlled rebuild/restart. [[src/main/android-logcat.test.ts]] covers split UTF-8, bounds, ownership, invalid serials and failures; [[src/renderer/src/screens/Chat/AndroidLogcat.test.tsx]] covers explicit start, filtering, pause, authorization and late-start cleanup. A real `adb devices -l` succeeded with no attached devices; on-phone streaming remains unverified.

## Pinned chat bar

The pinned bar and FAB share the chat-container containing block and one `top: 72px` rule. The floating collapsed pill uses zero margin and a 32px border-box with a full-height trigger.

The more specific floating collapsed rule overrides the later sticky collapsed margin. Expanded cards remain in the bounded left lane, clear of the rail and DB counter.

[[src/renderer/src/screens/Chat/MessageList.tsx#PinnedMessagesBar]] starts COLLAPSED on every mount, showing only the pin-count pill. Expanding it is a user action; the bubbles are not rendered until then.

## Speed-dial FAB

The floating control rail is collapsed behind a single grid-icon FAB (speed-dial pattern). Clicking the FAB expands all tool icons in a vertical animated stack; clicking FAB again or anywhere outside collapses it.

[[src/renderer/src/screens/Chat/SpeedDialFAB.tsx]] wraps any number of `items` (each a React node). It owns open/close state, outside-click dismissal, and Escape handling. The trigger stays first in the DOM; absolute-positioned tools expand below it without changing its position. Collapsed tools are inert and invisible, not keyboard targets. Item actions do not collapse their own Search or display popovers; outside pointer dismissal never cancels item clicks. Escape restores trigger focus. CSS keyframe `speed-dial-item-in` staggers entrance. No new dependencies added.

Floating rail buttons, chat search, the collapsed pin badge, and the DB message counter share the assistant-bubble background and primary text colors in [[src/renderer/src/assets/main.css]]. The collapsed pin's outer wrapper stays transparent so it does not create a double background; feature-local CSS retains layout only.

The message pin action uses a circular hit-area; other bubble action buttons keep their shared corner radius.

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

chatPanels.speedDial.test.tsx covers stable trigger DOM order, inert hidden tools, Search action clicks, outside dismissal, collapse/expand/Escape/aria states; SpeedDialFAB.layout.test.ts guards absolute below-trigger CSS without popover clipping, and OnFinishBanner keyboard shortcuts (Enter, N, R, Escape), click actions, and visibility.
