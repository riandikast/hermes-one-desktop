# Source Control (git)

The right-sidebar worktree panel can open a near-fullscreen Source Control dialog on any ROOT folder, giving VS Code-style git operations: status, staging, commit, pull/push/fetch, and merge-conflict resolution.

## Where it lives

Root-folder context menus open the full-page Source Control surface.

Right-clicking a root folder (one of the conversation's context folders) in [[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] shows a "Source Control" context-menu item (root folders only — `folderPaths.includes(contextMenu.path)`). It opens [[src/renderer/src/screens/Chat/SourceControlDialog.tsx#SourceControlDialog]], a near-fullscreen dialog (the same overlay/dialog shell as the file-changes dialog) with a branch chip (ahead/behind tracking), Fetch/Pull/Push/refresh buttons, a sidebar listing Conflicts / Staged / Changes / Untracked, a diff pane, and a commit box with Ctrl+Enter to commit.

## Git operations

The main process invokes git with separate arguments and bounded operation timeouts.

All git work runs in the main process ([[src/main/git.ts]]) by spawning the `git` CLI directly (no shell — args are passed as-is, so messages and paths are injection-safe), with `GIT_TERMINAL_PROMPT=0` (credential prompts never hang the UI), `GIT_PAGER=cat`, and a hard timeout (60s for local ops, 300s for pull/push/fetch). Network ops run in the background: Git Credential Manager ignores `GIT_TERMINAL_PROMPT=0` and opens its own login window, so a first `git push` from the dialog can sign in right there; if the helper isn't installed, the dialog surfaces a hint to run `git push` once in a terminal (or set up an SSH key).

## Token login (new machines)

Optional per-host tokens support HTTPS network operations on newly configured machines.

For github.com remotes, the top-header credential action opens GitHub credential manager settings and network operations defer to the configured Git credential helper. Existing app-specific GitHub tokens remain stored but are not used or deleted. Other hosts retain per-host tokens. The main process persists tokens in `userData/git-tokens.json`, encrypted with Electron `safeStorage` (DPAPI on Windows, plain base64 fallback when unavailable). [[src/main/git-credentials.ts]] owns the store, host extraction and bearer-header argument builder; [[src/main/git.ts#gitNetworkAuthArgs]] applies stored tokens only to non-GitHub hosts. Regressions: [[src/main/git-network-auth.test.ts]] and [[src/main/git-credentials.test.ts]].

Bearer auth works for both classic and **fine-grained** GitHub PATs. A fine-grained token must have **Contents: Read and write** (read for pull/fetch only) scoped to the target repos, plus the auto-granted **Metadata: Read**; otherwise push fails with 403. SSH remotes (`git@host:...`) never use the token — they use SSH keys. Status uses `git status --porcelain=v1 -b -z` (NUL-separated records — paths with spaces are safe; the `## branch...` header record is dropped before file parsing); ahead/behind come from the `-b` branch header. Conflict detection covers `U` statuses plus the `DD/AA/AU/UA/DU/UD` pairs. Staging is `git add`, unstaging `git restore --staged`, commit `git commit -m <message>`. Resolving a conflict runs `checkout --ours|--theirs` followed by `git add` (checkout alone leaves the index unmerged). IPC handlers live in [[src/main/ipc/register.ts]], exposed on `hermesAPI` via [[src/preload/index.ts]].

## Stage all changes

The Changes heading stages displayed tracked edits, deletions, and untracked files together through the existing gitStage API, leaving conflicts explicit.

Stage all changes appears only in the Changes parent heading context menu (right-click, ContextMenu, or Shift+F10), disabled when empty or busy. The bounded menu focuses its action and closes on outside pointer or Escape; Escape restores heading focus. A synchronous action lock prevents duplicate requests and stays held through status refresh; staging and refresh errors remain visible. No commit or push occurs. Mocked regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

## Ignore management and local graph

The compact sidebar places commit controls first, collapsible change groups next, then lazy Ignored and Graph sections, matching the requested VS Code workflow.

[[src/main/git-ignore.ts#gitIgnoreEdit]] edits only root .gitignore after explicit clicks, escapes literal anchored paths, rejects traversal and tracked paths, preserves line endings, and removes a selected rule only against its content version. No files are deleted or untracked. Existing broad rules require confirmation; nested, global and info/exclude rules are not edited. [[src/renderer/src/screens/Chat/IgnoredFiles.tsx#IgnoredFiles]] separates root rules from ignored paths, paging 100 paths with ignored directories collapsed. Git status has a 10-second timeout and shared Git output has an 8 MiB ceiling; pagination bounds returned paths, not the underlying status walk. Fixtures: [[src/main/git-ignore.test.ts]].

[[src/main/git.ts#gitLog]] reads all local refs in topological order, defaults to 60 commits in the UI and caps at 200. HEAD, branches, tags and remote-tracking refs stay visible. Existing [[src/renderer/src/screens/Chat/CommitGraph.tsx#CommitGraph]] lanes and commit diffs are reused; no login or network request is needed. Loading, failure and retry controls are explicit. Mocked regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

Design direction: requested VS Code familiarity, ENERGY 1 / RHYTHM 1 / MOTION 1. Existing theme tokens preserve app identity; compact rows and right-aligned status aid scanning, the eye-off icon means ignore, monospace is reserved for paths and history. Native details provide keyboard collapse with lucide right/down chevrons and themed hover; narrow layouts stack the sidebar and diff. Live visual verification remains manual because this task forbids launch/build/browser actions.

## Discard changes

Per-file discard confirms before restoring tracked regular files without staged changes. [[src/main/git.ts#gitDiscard]] rejects conflicts, untracked paths, traversal and symlinks; literal pathspecs protect other files.

## Git output

Git results appear in a themed, scrollable output panel with a draggable divider, keyboard-accessible separator, 14px monospace text, and live status or error announcements.

Pointer drag and separator ArrowUp/ArrowDown (10px), Home/End keys share a 40vh/400px maximum, with an 80px minimum; shrinking the viewport clamps the selected height. Regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

## Design notes

File selection, staging, and conflict resolution remain explicit.

- The dialog shows the diff of the selected file (raw unified diff) on demand via `git diff`/`git diff --cached`.
- Resolving a conflict moves the file to Staged (the `git add` marks it resolved) so a follow-up commit includes it.
- Pull uses `--no-edit` so an interactive merge-message editor can't hang inside the app.
- Covered by [[src/main/git.test.ts]] (real git repos created in temp dirs: status parsing, stage/unstage, commit, diff, conflict resolution, non-repo detection).

## Multi-selection and batch ignore

File rows carry a checkbox; a plain row click still opens the diff. Shift-clicking a checkbox or a row selects the contiguous range within the same visible group (Staged or Changes), anchored on the last plain selection.

Selection is an ordered `string[]` keyed `staged:<path>` / `changes:<path>`, pruned on every status refresh so a vanished file cannot be acted on, and never spans groups. A selection shows toolbar actions "Stage selected (n)" plus "Ignore selected (n)" without replacing the heading context menu; the Staged section offers "Unstage selected (n)".

Batch ignore goes through [[src/main/git-ignore.ts#gitIgnoreAddMany]] — one validated `.gitignore` write for the whole selection rather than one rewrite per row. Git can never ignore a path it already tracks, and a range selection normally mixes modified rows with untracked ones, so tracked paths are **skipped and reported** while the untracked part is written; the batch is refused only when every selected path is already tracked. Rules already present are skipped, and existing content and line endings are preserved. Regressions: [[src/main/git-ignore.test.ts]] and [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].
