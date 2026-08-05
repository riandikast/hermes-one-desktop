# Source Control (git)

The right-sidebar worktree panel can open a near-fullscreen Source Control dialog on any ROOT folder, giving VS Code-style git operations: status, staging, commit, pull/push/fetch, and merge-conflict resolution.

## Where it lives

Right-clicking a root folder (one of the conversation's context folders) in [[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] shows a "Source Control" context-menu item (root folders only — `folderPaths.includes(contextMenu.path)`). It opens [[src/renderer/src/screens/Chat/SourceControlDialog.tsx#SourceControlDialog]], a near-fullscreen dialog (the same overlay/dialog shell as the file-changes dialog) with a branch chip (ahead/behind tracking), Fetch/Pull/Push/refresh buttons, a sidebar listing Conflicts / Staged / Changes / Untracked, a diff pane, and a commit box with Ctrl+Enter to commit.

## Git operations

All git work runs in the main process ([[src/main/git.ts]]) by spawning the `git` CLI directly (no shell — args are passed as-is, so messages and paths are injection-safe), with `GIT_TERMINAL_PROMPT=0` (credential prompts never hang the UI), `GIT_PAGER=cat`, and a hard timeout (60s for local ops, 300s for pull/push/fetch). Network ops run in the background: Git Credential Manager ignores `GIT_TERMINAL_PROMPT=0` and opens its own login window, so a first `git push` from the dialog can sign in right there; if the helper isn't installed, the dialog surfaces a hint to run `git push` once in a terminal (or set up an SSH key).

## Token login (new machines)

A Personal Access Token (GitHub/GitLab PAT) lets a fresh PC push without the interactive credential flow. The dialog's token row (auto-detects the remote host from `git remote -v`) saves a token via `git-set-token`; the main process persists it per host in `userData/git-tokens.json`, each value encrypted with Electron `safeStorage` (DPAPI on Windows, plain base64 fallback when unavailable). [[src/main/git-credentials.ts]] owns the store, host extraction, and the `http.https://<host>/.extraHeader=Authorization: Bearer <token>` arg builder; the IPC layer wires a token provider into git.ts (`setGitTokenProvider`), and push/pull/fetch prepend those auth args whenever a token exists for the remote's host ([[src/main/git.ts#gitNetworkAuthArgs]]). Covered by [[src/main/git-credentials.test.ts]] (host parsing, auth-arg building, encrypted round-trip).

Bearer auth works for both classic and **fine-grained** GitHub PATs. A fine-grained token must have **Contents: Read and write** (read for pull/fetch only) scoped to the target repos, plus the auto-granted **Metadata: Read**; otherwise push fails with 403. SSH remotes (`git@host:...`) never use the token — they use SSH keys. Status uses `git status --porcelain=v1 -b -z` (NUL-separated records — paths with spaces are safe; the `## branch...` header record is dropped before file parsing); ahead/behind come from the `-b` branch header. Conflict detection covers `U` statuses plus the `DD/AA/AU/UA/DU/UD` pairs. Staging is `git add`, unstaging `git restore --staged`, commit `git commit -m <message>`. Resolving a conflict runs `checkout --ours|--theirs` followed by `git add` (checkout alone leaves the index unmerged). IPC handlers live in [[src/main/ipc/register.ts]], exposed on `hermesAPI` via [[src/preload/index.ts]].

## Design notes

- The dialog shows the diff of the selected file (raw unified diff) on demand via `git diff`/`git diff --cached`.
- Resolving a conflict moves the file to Staged (the `git add` marks it resolved) so a follow-up commit includes it.
- Pull uses `--no-edit` so an interactive merge-message editor can't hang inside the app.
- Covered by [[src/main/git.test.ts]] (real git repos created in temp dirs: status parsing, stage/unstage, commit, diff, conflict resolution, non-repo detection).
