import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { AppModal, AppModalTitle, AppModalDescription } from "../../components/modal/AppModal";
import type { GitBranchAction, GitBranchListResult } from "../../../../shared/git-branches";

export function BranchDialog({ dir, onClose, onChanged }: {
  dir: string;
  onClose: () => void;
  onChanged: (result: { ok: boolean; output?: string; error?: string }) => Promise<void>;
}): React.JSX.Element {
  const [data, setData] = useState<GitBranchListResult | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const load = async (): Promise<void> => {
    const result = await window.hermesAPI.gitBranches(dir);
    if (!result.ok) throw new Error(result.error || "Branches unavailable");
    setData(result);
  };
  useEffect(() => {
    let alive = true;
    void window.hermesAPI.gitBranches(dir).then((result) => {
      if (!alive) return;
      if (result.ok) setData(result); else setError(result.error || "Branches unavailable");
    }).catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [dir]);

  const change = async (action: GitBranchAction, branch: string): Promise<void> => {
    if (lock.current || !data) return;
    const current = data.current ?? "detached HEAD";
    const message = action === "merge" ? `Merge “${branch}” INTO “${current}”? Conflicts may require manual resolution. No push will occur.`
      : action === "delete" ? `Delete local branch “${branch}”? Git will refuse an unmerged or checked-out branch. No remote branch or disk files will be deleted.`
      : action === "checkout" ? `Switch from “${current}” to “${branch}”? Local changes must be committed or stashed first.`
      : `Create local branch “${branch}” from the current HEAD? This does not switch branches or push.`;
    if (!window.confirm(message)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await window.hermesAPI.gitBranchChange(dir, action, branch, data.current);
      if (!result.ok) setError(result.error || "Branch operation failed");
      else if (action === "create") setName("");
      // Read back both the list and parent repository status, even after merge conflicts.
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  return <AppModal open onOpenChange={(open) => { if (!open && !lock.current) onClose(); }}
    overlayClassName="source-control-branches-overlay" className="source-control-branches" describedBy="branch-description">
    <div className="source-control-branches-header">
      <AppModalTitle>Local branches</AppModalTitle>
      <button type="button" className="btn-ghost btn-sm" aria-label="Close branch manager" disabled={busy} onClick={onClose}><X size={16} /></button>
    </div>
    <AppModalDescription id="branch-description">Current: {data?.current ?? "detached HEAD"}. Switch, create, safely delete, or merge another branch into the current branch. Local only.</AppModalDescription>
    {error && <p role="alert">{error}</p>}
    {(!data || busy) && !error && <p className="source-control-loading-state" role="status"><LoaderCircle size={15} />{busy ? "Updating branches…" : "Loading branches…"}</p>}
    <form className="source-control-branch-create" onSubmit={(event) => { event.preventDefault(); void change("create", name.trim()); }}>
      <label htmlFor="new-local-branch">New branch name</label>
      <input id="new-local-branch" value={name} maxLength={1024} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="feature/example" />
      <button type="submit" className="btn-ghost btn-sm" disabled={busy || !data || !name.trim()}>Create branch</button>
    </form>
    <div className="source-control-branch-list">
      {data?.branches.length === 0 && <p>No local branches yet. Create an initial commit first.</p>}
      {data?.branches.map((branch) => <div className="source-control-branch-row" key={branch.name}>
        <span title={branch.name}>{branch.name}{branch.current ? " (current)" : branch.checkedOut ? " (other worktree)" : ""}</span>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Checkout ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("checkout", branch.name)}>Checkout</button>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Merge ${branch.name} into ${data.current ?? "current branch"}`} disabled={busy || branch.current || !data.current} onClick={() => void change("merge", branch.name)}>Merge into current</button>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Delete ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("delete", branch.name)}>Delete</button>
      </div>)}
    </div>
    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setError(""); void load().catch((err) => setError(String(err))); }}>Refresh branches</button>
  </AppModal>;
}
