import { appConfirm } from "../../components/modal/appConfirm";
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
  const [remoteName, setRemoteName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [renamingRemote, setRenamingRemote] = useState<string | null>(null);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [upstreamRemote, setUpstreamRemote] = useState("");
  const [upstreamBranch, setUpstreamBranch] = useState("");
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
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(message)) return;
      const result = await window.hermesAPI.gitBranchChange(dir, action, branch, data.current);
      if (!result.ok) setError(result.error || "Branch operation failed");
      else if (action === "create") setName("");
      // Read back both the list and parent repository status, even after merge conflicts.
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  const addRemote = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (lock.current || !data || !remoteName.trim() || !remoteUrl.trim()) return;
    const rName = remoteName.trim();
    const rUrl = remoteUrl.trim();
    const message = `Add remote "${rName}" pointing to "${rUrl}"?`;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(message)) return;
      const result = await window.hermesAPI.gitRemoteAdd(dir, rName, rUrl);
      if (!result.ok) setError(result.error || "Failed to add remote");
      else {
        setRemoteName("");
        setRemoteUrl("");
      }
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  const renameRemote = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (lock.current || !renamingRemote || !newRemoteName.trim()) return;
    const oldName = renamingRemote;
    const nextName = newRemoteName.trim();
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(`Rename remote “${oldName}” to “${nextName}”? Git updates local tracking configuration. Remote URLs and server branches stay unchanged. No fetch or push.`)) return;
      const result = await window.hermesAPI.gitRemoteRename(dir, oldName, nextName);
      if (!result.ok) setError(result.error || "Remote rename failed");
      else { setRenamingRemote(null); if (upstreamRemote === oldName) setUpstreamRemote(nextName); }
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  const updateUpstream = async (action: "set" | "unset" | "publish"): Promise<void> => {
    if (lock.current || !data?.current) return;
    const branch = data.current;
    const target = upstreamBranch.trim();
    const remote = data.remotes?.find((item) => item.name === upstreamRemote);
    if (action !== "unset" && (!remote || !target)) return;
    const message = action === "publish"
      ? `Push local branch “${branch}” to “${upstreamRemote}/${target}” at ${remote!.pushUrls.join(", ")} and set it as upstream? This publishes commits to the remote. No force push; other branches are not pushed.`
      : action === "set" ? `Set “${branch}” to track “${upstreamRemote}/${target}”? Local configuration only. No fetch or push.`
      : `Remove upstream tracking from “${branch}”? No local or remote branch is deleted. No push.`;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(message)) return;
      const result = await window.hermesAPI.gitBranchUpstream(dir, action, branch, upstreamRemote, target, remote?.pushFingerprint);
      if (!result.ok) setError(result.error || "Upstream operation failed");
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };
  const currentUpstream = data?.branches.find((branch) => branch.current)?.upstream;
  const knownTarget = data?.remoteBranches?.some((branch) => branch.remote === upstreamRemote && branch.name === upstreamBranch.trim());

  return <AppModal open onOpenChange={(open) => { if (!open && !lock.current) onClose(); }}
    overlayClassName="source-control-branches-overlay" className="source-control-branches" describedBy="branch-description">
    <div className="source-control-branches-header">
      <AppModalTitle>Local branches</AppModalTitle>
      <button type="button" className="btn-ghost btn-sm" aria-label="Close branch manager" disabled={busy} onClick={onClose}><X size={16} /></button>
    </div>
    <AppModalDescription id="branch-description">Current: {data?.current ?? "detached HEAD"}. Manage local branches, remote names and upstream tracking. Only “Publish and set upstream” pushes commits.</AppModalDescription>
    {error && <p role="alert">{error}</p>}
    {(!data || busy) && !error && <p className="source-control-loading-state" role="status"><LoaderCircle size={15} />{busy ? "Updating branches…" : "Loading branches…"}</p>}
    {data && <section aria-label="Repository remotes">
      <h4>Remotes</h4>
      <p>Remote names (for example origin or master) are aliases, not branch names.</p>
      {!data.remotes?.length && <p>No remotes configured.</p>}
      {data.remotes?.map((remote) => <div key={remote.name}>
        <strong>{remote.name}</strong>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Rename remote ${remote.name}`} disabled={busy} onClick={() => { setRenamingRemote(remote.name); setNewRemoteName(remote.name); }}>Rename</button>
        {renamingRemote === remote.name && <form className="source-control-branch-create" onSubmit={renameRemote}>
          <label htmlFor="rename-remote">New remote name</label>
          <input id="rename-remote" value={newRemoteName} maxLength={256} disabled={busy} onChange={(event) => setNewRemoteName(event.target.value)} />
          <button type="submit" className="btn-ghost btn-sm" disabled={busy || !newRemoteName.trim() || newRemoteName.trim() === remote.name}>Save remote name</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setRenamingRemote(null)}>Cancel rename</button>
        </form>}
        {remote.fetchUrls.map((url, index) => <p key={`fetch:${index}`} style={{ overflowWrap: "anywhere", userSelect: "text" }}>Fetch: <code>{url}</code></p>)}
        {remote.pushUrls.filter((url) => !remote.fetchUrls.includes(url)).map((url, index) => <p key={`push:${index}`} style={{ overflowWrap: "anywhere", userSelect: "text" }}>Push: <code>{url}</code></p>)}
      </div>)}
      <form className="source-control-branch-create" onSubmit={addRemote} style={{ marginTop: 8 }}>
        <label htmlFor="new-remote-name">Remote name</label>
        <input id="new-remote-name" value={remoteName} maxLength={256} disabled={busy} onChange={(e) => setRemoteName(e.target.value)} placeholder="origin" style={{ maxWidth: 120 }} />
        <label htmlFor="new-remote-url">Remote URL</label>
        <input id="new-remote-url" value={remoteUrl} maxLength={2048} disabled={busy} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/user/repo.git" style={{ flex: 2 }} />
        <button type="submit" className="btn-ghost btn-sm" disabled={busy || !data || !remoteName.trim() || !remoteUrl.trim()}>Add remote</button>
      </form>
    </section>}
    {data && <section aria-label="Upstream tracking">
      <h4>Upstream for {data.current ?? "detached HEAD"}</h4>
      <p>{currentUpstream ? `Tracking: ${currentUpstream}` : "No upstream branch configured."}</p>
      <div className="source-control-branch-create">
        <label htmlFor="upstream-remote">Upstream remote</label>
        <select id="upstream-remote" value={upstreamRemote} disabled={busy || !data.current} onChange={(event) => { setUpstreamRemote(event.target.value); setUpstreamBranch(data.current ?? ""); }}>
          <option value="">Select remote…</option>
          {data.remotes?.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
        </select>
        <label htmlFor="upstream-branch">Remote branch</label>
        <input id="upstream-branch" list="upstream-branches" value={upstreamBranch} maxLength={1024} disabled={busy || !data.current || !upstreamRemote} onChange={(event) => setUpstreamBranch(event.target.value)} placeholder={data.current ?? "main"} />
        <datalist id="upstream-branches">{data.remoteBranches?.filter((branch) => branch.remote === upstreamRemote).map((branch) => <option key={branch.name} value={branch.name} />)}</datalist>
        <button type="button" className="btn-ghost btn-sm" disabled={busy || !data.current || !knownTarget} onClick={() => void updateUpstream("set")}>Set upstream</button>
        <button type="button" className="btn-ghost btn-sm" disabled={busy || !data.current || !upstreamRemote || !upstreamBranch.trim()} onClick={() => void updateUpstream("publish")}>Publish and set upstream</button>
        <button type="button" className="btn-ghost btn-sm" disabled={busy || !data.current || !currentUpstream} onClick={() => void updateUpstream("unset")}>Unset upstream</button>
      </div>
      <p>Set upstream uses an existing fetched branch without pushing. Missing branch? Fetch from Source Control then refresh, or publish the current branch explicitly.</p>
    </section>}
    <form className="source-control-branch-create" onSubmit={(event) => { event.preventDefault(); void change("create", name.trim()); }}>
      <label htmlFor="new-local-branch">New branch name</label>
      <input id="new-local-branch" value={name} maxLength={1024} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="feature/example" />
      <button type="submit" className="btn-ghost btn-sm" disabled={busy || !data || !name.trim()}>Create branch</button>
    </form>
    <div className="source-control-branch-list">
      {data?.branches.length === 0 && <p>No local branches yet. Create an initial commit first.</p>}
      {data?.branches.map((branch) => <div className="source-control-branch-row" key={branch.name}>
        <span title={branch.name}>{branch.name}{branch.current ? " (current)" : branch.checkedOut ? " (other worktree)" : ""}{branch.upstream && <small className="source-control-branch-track"> · tracks {branch.upstream}</small>}</span>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Checkout ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("checkout", branch.name)}>Checkout</button>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Merge ${branch.name} into ${data.current ?? "current branch"}`} disabled={busy || branch.current || !data.current} onClick={() => void change("merge", branch.name)}>Merge into current</button>
        <button type="button" className="btn-ghost btn-sm" aria-label={`Delete ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("delete", branch.name)}>Delete</button>
      </div>)}
    </div>
    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setError(""); void load().catch((err) => setError(String(err))); }}>Refresh branches</button>
  </AppModal>;
}
