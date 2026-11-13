# Source Control (git)

The right-sidebar worktree panel can open a near-fullscreen Source Control dialog on any ROOT folder, giving VS Code-style git operations: status, staging, commit, pull/push/fetch, and merge-conflict resolution.

## Where it lives

Root-folder context menus open the full-page Source Control surface.

Right-clicking a root folder (one of the conversation's context folders) in [[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] shows a "Source Control" context-menu item (root folders only — `folderPaths.includes(contextMenu.path)`). It opens [[src/renderer/src/screens/Chat/SourceControlDialog.tsx#SourceControlDialog]], a near-fullscreen dialog (the same overlay/dialog shell as the file-changes dialog) with a branch chip (ahead/behind tracking), Fetch/Pull/Push/refresh buttons, a sidebar listing Conflicts / Staged / Changes / Untracked, a diff pane, and a commit box with Ctrl+Enter to commit.

## Floating window and narrow layout

The header's float toggle opens the same panel as a draggable, resizable window; narrow panels turn the split into tabs.

The choice is kept in `hermes.sourceControl.floating`. Floating mode renders through [[src/renderer/src/screens/Chat/FloatingDialog.tsx#FloatingDialog]] (size `wide`, `className="source-control-floating"`), so dragging, edge resizing and Escape match the terminal and web preview, while CSS hides the duplicate page title and close button. Below a 760px panel width — a small floating window or a narrow app window — `isNarrowSourceControl` switches the Changes split (list | diff) and the Graph split (history | commit) to a tab switcher and hides the split handle. The same breakpoint marks the header `is-compact`: the long title is dropped, the branch chip truncates, and the action buttons stay on one row at the tab height, scrolling horizontally between the pinned float/close buttons instead of wrapping into a ragged block. The tab strip itself also scrolls rather than clipping its last tab. Below 760px of window width the float toggle is disabled and the panel stays full-page. Owned terminal sessions keep running across the swap; [[src/renderer/src/screens/Chat/useSourceControlTerminals.ts]] re-attaches their ptys to the remounted dock. Regressions: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]] and [[src/renderer/src/screens/Chat/useSourceControlTerminals.test.tsx]].

## Initialize repository

The non-repository screen offers Initialize repository beside Retry. Confirmation names the folder; initialization creates local Git metadata only, then refreshes into Source Control.

[[src/main/git.ts#gitInit]] accepts an existing absolute directory, rejects existing repositories, nested working folders, symbolic-link targets and damaged metadata, serializes duplicate requests, runs `git init`, then verifies repository status. No files are staged or committed, no remote is added, and nothing is pushed. Errors remain visible with retry available. The installed Git default initial branch is respected. IPC/preload changes require a user-controlled rebuild/restart. Regressions: [[src/main/git.test.ts]], [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

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

The compact sidebar places commit controls first, collapsible change groups next, then lazy Ignored rules and paths. Local history lives only in the Graph tab.

Ignored subsection headings use a 44px left margin; rule, empty labels, and ignored-path rows use 44px. Ignored loading animation renders below search tools. An icon-only toggle sorts by name or newest filesystem modification before the 100-path cap; metadata reads use batches of 32 and never recurse into ignored directories. Rules have no per-line timestamps, so date mode shows reverse rule-file order. Sorting resets range anchors; Shift selection follows displayed order. Rules and paths support Shift-range selection; unignore adds a literal root exception without deleting files. File status codes provide hover tooltips with secondary text coloring, and action buttons keep eye-ignore before stage controls.

[[src/main/git-ignore.ts#gitIgnoreEdit]] edits only root .gitignore after explicit clicks, escapes literal anchored paths, rejects traversal and tracked paths, preserves line endings, and removes a selected rule only against its content version. No files are deleted or untracked. Existing broad rules require confirmation; nested, global and info/exclude rules are not edited. [[src/renderer/src/screens/Chat/IgnoredFiles.tsx#IgnoredFiles]] separates root rules from ignored paths, paging 100 paths with ignored directories collapsed. Git status has a 10-second timeout and shared Git output has an 8 MiB ceiling; pagination bounds returned paths, not the underlying status walk. Fixtures: [[src/main/git-ignore.test.ts]].

[[src/main/git.ts#gitLog]] reads local refs except `refs/stash` in topological order, defaults to 50 commits in the UI and caps at 200. Excluding stash before the limit keeps its internal index/untracked commits out of Graph without hiding branch, tag or remote history. HEAD, branches, tags and remote-tracking refs stay visible. Existing [[src/renderer/src/screens/Chat/CommitGraph.tsx#CommitGraph]] lanes and commit diffs are reused; no login or network request is needed. Loading, failure and retry controls are explicit. Initial repository status uses an animated status spinner, not a missing worktree translation key. The UI fetches and renders up to 50 commits; no older-history pagination exists. Optional From/To date inputs query Git only on Apply; Refresh retains the applied range, not unsaved date edits. Bounds are inclusive UTC calendar days of the committer timestamp (row dates remain author timestamps). Invalid/reversed dates are rejected. `--since-as-filter` preserves matches behind older-dated descendants; filtering precedes the result cap. Clearing both dates and applying restores latest history. Apply stays horizontally beside the date inputs with matching height and bottom alignment. Renderer hot reload alone cannot activate new main-process Git filters: an old loaded bundle ignores date options, requiring a user-controlled rebuild/restart. Diagnose the loaded bundle before modifying already-working date queries. Commit rows provide a context menu to copy commit IDs or revert commits with confirmation. The menu closes when its graph list or an ancestor scrolls, not when unrelated panes scroll; the capture listener is removed on dismissal or unmount. Only in-progress reverts render the cancel revert action in the graph toolbar, which confirms and executes git revert --abort. Mocked regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

Design direction: requested VS Code familiarity, ENERGY 1 / RHYTHM 1 / MOTION 1. Existing theme tokens preserve app identity; compact rows and right-aligned status aid scanning, the eye-off icon means ignore, monospace is reserved for paths and history. Native details provide keyboard collapse with lucide right/down chevrons and themed hover; narrow layouts stack the sidebar and diff. Live visual verification remains manual because this task forbids launch/build/browser actions.

## Stash management

Stash appears above Staged as filename/status rows with checkboxes, Shift ranges, file diffs, and confirmed per-file Restore/Delete. One stash shows files directly; multiple stashes add collapsible groups. Changes/Staged selections create stashes.

Git stash creates internal commits under `refs/stash`, not a new branch HEAD. Rename eligibility remains tied to actual HEAD; regression covers renaming after stashing while preserving the saved stash. Stashing running development source can trigger electron-vite reload/restart because files change on disk; creation confirmation warns about watchers. The stash action does not call app restart.

[[src/renderer/src/screens/Chat/StashSection.tsx#StashSection]] keeps ordered hash/path selections independent of shifting `stash@{n}` labels; refresh prunes deleted files. Plain row clicks preview that file only; Shift-clicking rows or checkboxes extends a range inside its stash group. Restore keeps saved copies, requires a clean worktree, and never silently applies the whole stash. Delete confirms permanent loss of selected saved changes, preserving other files. Loading, empty and error states remain visible; shared operation locking disables mutations while busy. Stash reload starts before awaiting repository status, so a slow/failed status request cannot block the refreshed saved-file list. Failed stash reads are isolated: readable groups remain visible with per-stash errors, without repeated Error prefixes.

[[src/main/git-stash-files.ts]] provides file listing, diffs, selected restoration and selected saved-change removal. Removing only part of a stash must retain unselected worktree, index and untracked payload; deleting its final saved change removes the empty stash. Tree parsing retains submodule gitlinks, so a repository containing submodules supports normal saved-file listing, preview, restoration and partial deletion. Gitlinks survive rewriting untouched; selecting a submodule itself remains unsupported. Tests: [[src/main/git-stash-files.test.ts]].

[[src/main/git-stash.ts]] validates selected paths and stash membership before Git operations. Creation saves both staged and unstaged versions of selected paths, including untracked files but never ignored content. Collapsed untracked directory rows (`folder/`) expand through literal `ls-files --others --exclude-standard`; symlink ancestors, traversal, ignored files and tracked neighbors stay excluded. Expansion remains bounded to 200 files and 16000 path characters. Invalid-path errors include the rejected path. Apply requires a clean starting worktree and preserves saved copies if conflicts occur. Drop resolves current refs from hashes after each removal, avoiding index-renumbering mistakes. Staged deletions and rename source paths are rejected before mutation with an unstage instruction. Apply restores content without restoring the staged/unstaged split (`--index` is omitted). External Git clients can race ref lookup during drop; avoid concurrent stash edits. No pop, clear-all, force, remote operation, or Python backend change. Regressions: [[src/main/git-stash.test.ts]], [[src/renderer/src/screens/Chat/StashSection.test.tsx]], [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

## Discard changes

Per-file discard confirms before restoring tracked regular files without staged changes. [[src/main/git.ts#gitDiscard]] rejects conflicts, untracked paths, traversal and symlinks; literal pathspecs protect other files.

Discard appears only in an eligible file's context menu (right-click, ContextMenu, Shift+F10), never inline. Cancellation performs no write; Escape restores file focus. Ignored uses the shared disclosure chevrons, indented rows, and named icon-only rule removal. Pull is text-only; the branch badge uses accent contrast. Graph loading hides the empty state, and text rows reserve the SVG lane gutter with an outer margin. Regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

## Rename unpublished commit

Rename appears only after HEAD passes eligibility checks. Older commits omit it. Failed checks show a reason, not a disabled editor. Renaming older unpublished commits requires rebasing descendants.

[[src/renderer/src/screens/Chat/RenameCommitDialog.tsx#RenameCommitDialog]] receives the full prevalidated message, preserving its body, and opens an enabled, focused editor. Eligibility runs on HEAD context-menu opening; pending/failed checks omit Rename. Saving still revalidates in the backend and warns that the commit ID changes. [[src/main/git-rename.ts#gitRenameCheck]] requires clean worktree/index, attached HEAD matching the full ID, no unfinished Git operation, and no remote-tracking reachability. It also checks advertised heads/tags with `ls-remote`, refusing unavailable remote objects or unreachable remotes instead of assuming unpublished status. [[src/main/git-rename.ts#gitRenameCommit]] revalidates before `commit --amend --only -m`, preventing unrelated staged paths from being included. Remote publication can race the check; no push or force-push occurs. Tests: [[src/main/git-rename.test.ts]], [[src/renderer/src/screens/Chat/RenameCommitDialog.test.tsx]].

## Local branch manager

The branch badge opens a compact tabbed manager — **Branches**, **Remotes**, **Upstream** — with no standing prose. Each mutation confirms its direction and scope before running Git. The current branch is a header pill.

Checkout, create, merge into the current branch, and safe deletion stay local. Each remote shows its URL as a bordered field with a pencil; clicking it opens the inline editor (Fetch URL, optional Separate push URL, Push URL) with Save/Cancel beside Rename on the same row. New remotes are added on demand.

Existing remotes can be retargeted in place: [[src/main/git-branches.ts#gitRemoteSetUrl]] uses `git remote set-url` (never remove/re-add), so tracking configuration, remote-tracking refs and the remote alias survive; it refuses an unchanged URL, an unknown remote and invalid arguments, then reads the stored URLs back before reporting success. Confirmation names both the old and new URL; no fetch or push runs. If the preload predates the IPC handler, the editor says to restart Hermes instead of failing silently.

[[src/renderer/src/screens/Chat/BranchDialog.tsx#BranchDialog]] uses the shared focus-trapped modal above Source Control. [[src/main/git-branches.ts#gitBranches]] lists local refs and linked-worktree ownership. [[src/main/git-branches.ts#gitBranchChange]] validates ref names and expected current branch, blocks unfinished Git operations, requires a clean worktree for checkout/merge, protects ignored files from overwrite, and refuses deletion unless merged into current HEAD and not checked out anywhere. Creation starts at HEAD without switching. No force flags, remote deletion or push. Conflicts remain visible for existing resolution tools; branch/status/history refresh follows every result. Real Git regressions: [[src/main/git-branches.test.ts]]; UI confirmations and locking: [[src/renderer/src/screens/Chat/BranchDialog.test.tsx]].

## Remote names and upstream tracking

Remote aliases are distinct from branch names. The branch manager supports confirmed remote rename, Track (upstream only, never uploads), Push & track, and Unset.

[[src/main/git-branches.ts#gitRemoteRename]] uses Git's remote rename so tracking references/configuration follow the alias without changing URLs or server branches. [[src/main/git-branches.ts#gitBranchUpstream]] validates the current branch, remote and target, serializes mutations, and reads tracking back after success. **Track** needs no prior fetch: if the remote-tracking ref is missing, it fetches that one ref first (read-only, no push) and then sets tracking, including the remote/merge config. **Unset** removes only the tracking configuration; the branch and its commits stay.

**Push & track** is the only action that uploads: it pushes one explicit refspec to the selected remote branch, then tracks it. Without force, mirror, followed tags or recursive submodule pushes; authentication resolves the selected remote host. No global push.autoSetupRemote change or automatic publish occurs. Detached/stale branch requests fail closed. Main/preload changes require a user-controlled rebuild/restart. Real Git tests use local bare fixtures only: [[src/main/git-upstream.test.ts]] and [[src/main/git-branches.test.ts]]. UI cancellation, tracking refresh, duplicate locks and errors: [[src/renderer/src/screens/Chat/BranchDialog.upstream.test.tsx]].

A SHA-256 fingerprint binds confirmation to raw push URLs without returning credentials; changed destinations require refresh and reconfirmation. Tracking verification uses full upstream refs plus remote/merge configuration, avoiding ambiguous short names. External Git clients can still race the final check; avoid concurrent configuration edits while publishing. Live GUI verification is pending because the running desktop has no CDP connection.

## Resizable panes, reference and terminals

Terminal is text-only; its pane uses the same bounded pointer/keyboard splitter as Changes and Graph. Git Doc lists common commands without executing them. Source Control owns its embedded terminal sessions and confirms before closing them.

[[src/renderer/src/screens/Chat/SourceControlSplit.tsx#SourceControlSplit]] uses a 20–80 percent grid split with pointer capture, cancellation and ArrowLeft/ArrowRight/Home/End resizing. The terminal split collapses before its first explicit opening without remounting active sessions. The document and terminal pane remain scrollable on narrow layouts.

[[src/renderer/src/screens/Chat/GitDoc.tsx#GitDoc]] lists inspection, staging, branch, remote, stash and undo commands, including destructive-operation warnings. No commands run automatically. The Terminal header action precedes GitHub credentials and creates shells in the selected repository through existing PTY IPC. [[src/renderer/src/screens/Chat/useSourceControlTerminals.ts#useSourceControlTerminals]] tracks only owned IDs, guards duplicate creates, confirms Close/Escape/credential-navigation exits, awaits terminal kills, and kills late create replies after closure or unmount. Cancelling keeps terminals running. Escape inside the terminal belongs to the shell. Tab changes never unmount the terminal dock. [[src/renderer/src/screens/Command/TerminalDock.tsx#TerminalDock]] retains existing default behavior; Source Control opts into xterm/listener disposal on unmount and tab-close ownership notifications. Forced parent unmount cleans owned sessions without touching other docks. Regressions: [[src/renderer/src/screens/Chat/useSourceControlTerminals.test.tsx]], [[src/renderer/src/screens/Chat/SourceControlSplit.test.tsx]], [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]], [[src/renderer/src/screens/Command/TerminalDock.newSession.test.tsx]].

The Terminal button toggles pane visibility without killing sessions or unmounting the dock. Its pressed state uses a theme-aware background and accent underline; its hover hint says Show or Hide. Closing the final shell or failing its initial spawn hides the empty pane. Reopening restores shells or creates one when empty; the dock's new-session control adds more.

## Git output

Git results appear in a themed, scrollable output panel with a draggable divider, keyboard-accessible separator, 14px monospace text, and live status or error announcements.

Its icon-only close control clears visible output/error without cancelling Git; the next result shows the panel again.

Pointer drag and separator ArrowUp/ArrowDown (10px), Home/End keys share a 40vh/400px maximum, with an 80px minimum; shrinking the viewport clamps the selected height. Regression: [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].

## Design notes

File selection, staging, and conflict resolution remain explicit.

- The dialog shows the diff of the selected file (raw unified diff) on demand via `git diff`/`git diff --cached`.
- Resolving a conflict moves the file to Staged (the `git add` marks it resolved) so a follow-up commit includes it.
- Pull uses `--no-edit` so an interactive merge-message editor can't hang inside the app.
- Covered by [[src/main/git.test.ts]] (real git repos created in temp dirs: status parsing, stage/unstage, commit, diff, conflict resolution, non-repo detection).

## Multi-selection and batch ignore

File rows carry a checkbox; a plain row click still opens the diff. Shift-clicking a checkbox or a row selects the contiguous range within the same visible group (Staged or Changes), anchored on the last plain selection.

Selection is an ordered array keyed by group and path, pruned on every status refresh so vanished rows cannot be acted on. Shift ranges stay within their displayed group. Each file section provides Select all / Unselect all; partial selections append missing visible rows in displayed order, while clearing removes only that section. Ignored toggles cover filtered/displayed rows, never unseen matches. Stash groups have scoped toggles as well as the parent section. Empty, loading or busy controls are disabled; bulk selection never runs a Git action. A selection shows toolbar actions "Stage selected (n)" plus "Ignore selected (n)" without replacing the heading context menu; the Staged section offers "Unstage selected (n)".

Batch ignore goes through [[src/main/git-ignore.ts#gitIgnoreAddMany]] — one validated `.gitignore` write for the whole selection rather than one rewrite per row. Git can never ignore a path it already tracks, and a range selection normally mixes modified rows with untracked ones, so tracked paths are **skipped and reported** while the untracked part is written; the batch is refused only when every selected path is already tracked. Rules already present are skipped, and existing content and line endings are preserved. Regressions: [[src/main/git-ignore.test.ts]] and [[src/renderer/src/screens/Chat/SourceControlDialog.test.tsx]].
