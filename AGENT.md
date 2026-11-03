# Source Control handoff

Graph history supports optional From/To UTC committer-date filters. Apply queries Git; editing dates does not fetch. Refresh retains the applied range. Clearing both dates and applying restores latest history. Fetch and renderer both cap at 50 commits; no pagination.

Backend validates calendar dates and range order. `--since-as-filter` avoids dropping matching ancestors behind out-of-order timestamps. End date includes 23:59:59 UTC. Displayed row dates remain author dates.

Relevant files: `src/main/git.ts`, `src/renderer/src/screens/Chat/SourceControlDialog.tsx`, `lat.md/source-control.md`. Focused regressions: `src/main/git.test.ts`, `src/renderer/src/screens/Chat/SourceControlDialog.test.tsx`.

Floating chat rail icons, search, collapsed pinned badge, and DB message counter share assistant-bubble and primary text colors in `src/renderer/src/assets/main.css`; the collapsed pin wrapper must stay transparent, with layout only in feature CSS.

When date filters appear in the renderer but return unchanged data, inspect the running Electron main bundle before changing Git logic. Renderer hot reload does not update main-process IPC. The observed stale `out/main/index.js` omitted date options entirely; rebuild/restart is user-controlled. Apply uses a no-wrap, bottom-aligned filter row matching input/button height.

Branch badge opens local-only checkout/create/merge/delete commands with confirmation. Delete requires fully merged into current HEAD and not checked out in any worktree; checkout/merge require clean worktree and protect ignored content. New code: `src/main/git-branches.ts`, `src/renderer/src/screens/Chat/BranchDialog.tsx`. Ignored sort is icon-only (name or path modification time; rules use reverse file order). Git output has a close icon.

Source Control now has draggable/keyboard left-right splitters, Git Doc reference, and multiple owned shells using existing TerminalDock/PTY IPC. Closing through Close/Escape/credentials confirms and kills only Source Control terminals; late spawn replies and forced unmount also clean up. New code: `SourceControlSplit.tsx`, `GitDoc.tsx`, `useSourceControlTerminals.ts`. Do not unmount terminals on tab changes or kill other docks.

Terminal header is text-only and its width reuses SourceControlSplit. Initial repository and explorer folder/search loaders use accessible spinners. Graph Rename commit appears first only after attached unpublished HEAD passes the menu-time check; pending/failed validation shows a reason instead of opening a disabled field. RenameCommitDialog receives the validated message and opens enabled/focused. `git-rename.ts` rechecks clean state and advertised remote heads/tags before amend, fails closed for unknown remote history, preserves full message via RenameCommitDialog. Older commits need a separate rebase design.

Terminal header toggles visibility without unmount/kill; pressed styling and Show/Hide hints expose its state. Final session closure and initial spawn failure hide the empty pane. Dock new-session action remains separate. ToolEntryProvider snapshots existing IDs on tab activation/session entry; existing tool groups/items skip animation but MUST retain the shared mount queue (bulk synchronous bodies caused freezes). Preserve snapshot identity on unchanged tab returns/deactivation to avoid context-wide rerenders. New live tools retain motion. Chat forwards active to MessageList for parent/subagent tabs.

Graph excludes refs/stash before the history cap; stash internals are not branch HEAD and must not displace rename eligibility. Stashing dev source can trigger electron-vite watchers, so confirmation warns about reload/restart.

Stash section above Staged displays filenames/status, not stash messages. Single stash is flat; multiple stashes use collapsible groups. Ordered hash/path multi-selection, group-local Shift ranges, file-only preview, confirmed Restore/Delete selected preserve unselected saved changes. New git-stash-files.ts owns file operations. Keep gitlinks in parsed trees; unrelated submodules must not block regular-file operations. Reload stash independently before awaiting status; isolate per-stash read failures so valid groups stay visible. Changes/Staged selected files can be stashed (both staged and unstaged edits, selected untracked included, ignored excluded). Collapsed untracked folder/ rows expand non-ignored untracked contents only, retain path/symlink guards and batch limits; path validation errors name the rejected path. Apply keeps saved copies; drop resolves current refs by immutable hash. New Electron IPC/preload requires user-controlled rebuild/restart.

Select/Unselect all applies to each file section (Conflicts, Stash/groups, Staged, Changes, Ignored/rules/files), preserves ordered selection and unrelated groups, resets Shift anchors. Ignored selects only displayed filtered rows. Selection toggles never execute Git mutations.

Non-repository Source Control offers confirmed Initialize repository beside Retry. gitInit validates an existing absolute directory, rejects existing/nested repos and damaged metadata, serializes requests, runs git init and verifies status. No stage/commit/remote/push; Git default branch respected.

Renderer confirmations use async appConfirm (in-page dialog), never native window.confirm; Electron Windows native prompts can leave inputs dead until taskbar refocus, not dev-only. Preserve deny defaults, awaited mutation ordering, nested Radix focus scope and prior focus restore. BranchDialog displays configured sanitized remote URLs and supports adding new remotes with in-page confirmation; no automatic network operations or unrequested remote mutations.

Settings → Keyboard Shortcuts is now the UI for the shared shortcut registry: record/reset/unassign, conflict + modifier validation, capture-phase listener, and menu-accelerator suppression while recording. App loads saved overrides at startup (`loadKeyboardShortcuts`). New code: `components/settings/ShortcutsPane.tsx`, `shared/keyboard-shortcuts.ts`; docs `lat.md/ui-zoom.md`.

File editor: fold-gutter glyphs are replaced by masked chevron icons (CodeMirror markers keyed by their Fold/Unfold title). Auto-save is per-tab, seeded from Settings → Utils default (`hermes.fileEditor.autoSave`, default on); manual mode exposes Save + Unsaved and cancels a pending debounce as dirty. Utils pane uses the segmented control style.

Preserve unrelated chat-search/zoom work. Commit owned changes only; do not push without confirmation. Follow `AGENTS.md` resource queue and documentation checks.

Theme editor saves compare built-in palettes against pristine bundled defaults, not the effective editor baseline (which dropped older overrides on later saves). Custom themes save complete palettes, including on rename. Reset only built-in overrides; custom themes use confirmed Delete. Storage stays `hermes-custom-themes`, separate from bundled CSS. See `lat.md/appearance-themes.md` and `ThemeEditor.integration.test.tsx`.

Branch manager distinguishes remote aliases from branches. Confirmed remote rename preserves URLs and updates tracking via Git. Set/unset upstream is local-only; Publish and set upstream explicitly confirms push URLs/branch and uses one non-force refspec. Validate current branch before mutation; read back tracking afterward. New main/preload IPC requires user-controlled rebuild/restart. Fixtures: `git-upstream.test.ts`, `BranchDialog.upstream.test.tsx`.

Publish carries a raw-destination fingerprint through IPC; reject remote URLs changed since confirmation. Verify full upstream refs and branch remote/merge configuration, not Git's ambiguous short ref output. Avoid concurrent external Git configuration edits during publish.

FloatingDialog owns touch/pointer and keyboard corner resizing for terminal/browser/explorer; outside taps never dismiss. Preserve mounted children and xterm ResizeObserver fitting. Ctrl+Shift+T invokes the explicit new-terminal handler only for the active chat's open terminal, captured before xterm; Ctrl+T toggle stays unchanged. Sidebar layout is unchanged. Minimum floating width is 237px (default left sidebar); the open overlay must keep pointer-events:none, with pointer-events:auto only on the panel, so outside search/composer inputs remain usable. Regression: FloatingDialog.resize.test.tsx; docs commands-terminal.md.
