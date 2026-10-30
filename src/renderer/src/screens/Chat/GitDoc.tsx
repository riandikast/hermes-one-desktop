const commands = [
  ["Inspect", "git status", "Show staged, unstaged and untracked changes."],
  ["Inspect", "git diff", "Review unstaged edits; git diff --staged reviews staged edits."],
  ["Inspect", "git log --oneline --graph --decorate -50", "Read recent local history."],
  ["Stage", "git add -- <path>", "Stage one path. Replace angle-bracket placeholders; do not type them literally."],
  ["Stage", "git restore --staged -- <path>", "Unstage a path without discarding its working changes."],
  ["Commit", 'git commit -m "message"', "Create a local commit from staged changes."],
  ["Branch", "git branch", "List local branches; git branch -a also shows remote-tracking branches."],
  ["Branch", "git switch <branch>", "Switch to an existing branch; commit or stash local edits first."],
  ["Branch", "git switch -c <new-branch>", "Create a branch from HEAD and switch to it."],
  ["Branch", "git merge <branch>", "Merge the named branch INTO the current branch; conflicts may need resolution."],
  ["Branch", "git merge --abort", "Cancel an unfinished merge; review local edits before aborting."],
  ["Branch", "git branch -d <branch>", "Safely delete a merged local branch. Does not delete its remote branch."],
  ["Remote", "git fetch", "Download remote refs without merging into your branch."],
  ["Remote", "git pull --ff-only", "Update only if a fast-forward is possible; refuses divergent history."],
  ["Remote", "git push", "Publish local commits to the configured remote branch."],
  ["Remote", "git push -u origin <branch>", "Publish a new branch and configure its upstream."],
  ["Stash", "git stash push -u -m \"message\"", "Set aside tracked and untracked edits (not ignored files)."],
  ["Stash", "git stash list", "List stashes; git stash apply restores one without deleting it."],
  ["Undo", "git revert <commit-id>", "Create a new commit undoing that commit—not restore a snapshot or rewind history."],
  ["Undo", "git revert --abort", "Cancel an unfinished revert, not one that already completed."],
  ["Undo", "git restore -- <path>", "DESTRUCTIVE: discard unstaged edits to a tracked path. Review git diff first."],
] as const;

export function GitDoc(): React.JSX.Element {
  return <section className="source-control-git-doc" aria-label="Git command reference">
    <h2>Common Git commands</h2>
    <p>Reference only—nothing runs when you open this tab. Commands use the terminal’s current folder. Review changes before undo, merge or push.</p>
    <dl>{commands.map(([group, command, description]) => <div key={command}>
      <dt><small>{group}</small><code>{command}</code></dt>
      <dd>{description}</dd>
    </div>)}</dl>
  </section>;
}
