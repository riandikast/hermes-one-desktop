# Source Control handoff

Graph history supports optional From/To UTC committer-date filters. Apply queries Git; editing dates does not fetch. Refresh retains the applied range. Clearing both dates and applying restores latest history. Fetch and renderer both cap at 50 commits; no pagination.

Backend validates calendar dates and range order. `--since-as-filter` avoids dropping matching ancestors behind out-of-order timestamps. End date includes 23:59:59 UTC. Displayed row dates remain author dates.

Relevant files: `src/main/git.ts`, `src/renderer/src/screens/Chat/SourceControlDialog.tsx`, `lat.md/source-control.md`. Focused regressions: `src/main/git.test.ts`, `src/renderer/src/screens/Chat/SourceControlDialog.test.tsx`.

When date filters appear in the renderer but return unchanged data, inspect the running Electron main bundle before changing Git logic. Renderer hot reload does not update main-process IPC. The observed stale `out/main/index.js` omitted date options entirely; rebuild/restart is user-controlled. Apply uses a no-wrap, bottom-aligned filter row matching input/button height.

Branch badge opens local-only checkout/create/merge/delete commands with confirmation. Delete requires fully merged into current HEAD and not checked out in any worktree; checkout/merge require clean worktree and protect ignored content. New code: `src/main/git-branches.ts`, `src/renderer/src/screens/Chat/BranchDialog.tsx`. Ignored sort is icon-only (name or path modification time; rules use reverse file order). Git output has a close icon.

Preserve unrelated chat-search/zoom work. Commit owned changes only; do not push without confirmation. Follow `AGENTS.md` resource queue and documentation checks.
