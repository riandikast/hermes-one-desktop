import { appConfirm } from "../../components/modal/appConfirm";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { AppModal, AppModalTitle, AppModalDescription } from "../../components/modal/AppModal";
import type { GitBranchAction, GitBranchListResult } from "../../../../shared/git-branches";

type Tab = "branches" | "remotes" | "upstream";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "branches", label: "Branches" },
  { id: "remotes", label: "Remotes" },
  { id: "upstream", label: "Upstream" },
];

/** Branch / remote / upstream manager. Compact tabbed panel; confirmations stay in dialogs. */
export function BranchDialog({ dir, onClose, onChanged }: {
  dir: string;
  onClose: () => void;
  onChanged: (result: { ok: boolean; output?: string; error?: string }) => Promise<void>;
}): React.JSX.Element {
  const [data, setData] = useState<GitBranchListResult | null>(null);
  const [tab, setTab] = useState<Tab>("branches");
  const [name, setName] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [addingRemote, setAddingRemote] = useState(false);
  const [renamingRemote, setRenamingRemote] = useState<string | null>(null);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editFetchUrl, setEditFetchUrl] = useState("");
  const [editPushUrl, setEditPushUrl] = useState("");
  const [editSeparatePush, setEditSeparatePush] = useState(false);
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
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(`Add remote “${rName}” → ${rUrl}?`)) return;
      const result = await window.hermesAPI.gitRemoteAdd(dir, rName, rUrl);
      if (!result.ok) setError(result.error || "Failed to add remote");
      else { setRemoteName(""); setRemoteUrl(""); setAddingRemote(false); }
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
      if (!await appConfirm(`Rename remote “${oldName}” to “${nextName}”? Tracking follows the new name. No fetch or push.`)) return;
      const result = await window.hermesAPI.gitRemoteRename(dir, oldName, nextName);
      if (!result.ok) setError(result.error || "Remote rename failed");
      else { setRenamingRemote(null); if (upstreamRemote === oldName) setUpstreamRemote(nextName); }
      await load();
      await onChanged(result);
    } catch (err) { setError(String(err)); }
    finally { lock.current = false; setBusy(false); }
  };

  const changeRemoteUrl = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (lock.current || !data || !editingRemote) return;
    const remote = data.remotes?.find((item) => item.name === editingRemote);
    if (!remote) return;
    const nextFetch = editFetchUrl.trim();
    const nextPush = editSeparatePush ? editPushUrl.trim() : undefined;
    if (!nextFetch || (editSeparatePush && !nextPush)) return;
    if (typeof window.hermesAPI.gitRemoteSetUrl !== "function") {
      setError("Restart Hermes to enable remote URL changes.");
      return;
    }
    const message = `Change “${remote.name}” from ${remote.fetchUrls.join(", ")} to ${nextFetch}?` +
      (nextPush ? ` Push URL becomes ${nextPush}.` : "") +
      " Tracking is kept. No fetch or push.";
    lock.current = true; setBusy(true); setError("");
    try {
      if (!await appConfirm(message)) return;
      const result = await window.hermesAPI.gitRemoteSetUrl(dir, remote.name, nextFetch, nextPush);
      if (!result.ok) setError(result.error || "Failed to change remote URL");
      else setEditingRemote(null);
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

  const startRemoteEdit = (remote: NonNullable<GitBranchListResult["remotes"]>[number]): void => {
    const separatePush = remote.pushUrls.find((url) => !remote.fetchUrls.includes(url)) ?? "";
    setRenamingRemote(null);
    setEditingRemote(remote.name);
    setEditFetchUrl(remote.fetchUrls[0] ?? "");
    setEditSeparatePush(!!separatePush);
    setEditPushUrl(separatePush || remote.fetchUrls[0] || "");
  };

  return <AppModal open onOpenChange={(open) => { if (!open && !lock.current) onClose(); }}
    overlayClassName="source-control-branches-overlay" className="source-control-branches" describedBy="branch-description">
    <div className="source-control-branches-header">
      <AppModalTitle>Branches</AppModalTitle>
      <span className="source-control-current-branch" title="Current branch">{data?.current ?? "detached HEAD"}</span>
      <span className="source-control-header-actions">
        <button type="button" className="btn-ghost btn-sm" aria-label="Refresh branches" title="Refresh" disabled={busy}
          onClick={() => { setError(""); void load().catch((err) => setError(String(err))); }}>
          <RefreshCw size={14} />
        </button>
        <button type="button" className="btn-ghost btn-sm" aria-label="Close branch manager" disabled={busy} onClick={onClose}><X size={16} /></button>
      </span>
    </div>
    <AppModalDescription id="branch-description" className="source-control-visually-hidden">
      Current branch {data?.current ?? "detached HEAD"}. Manage local branches, remotes and upstream tracking.
    </AppModalDescription>

    <div className="source-control-branch-tabs" role="tablist" aria-label="Branch settings">
      {TABS.map((entry) => (
        <button key={entry.id} type="button" role="tab" id={`branch-tab-${entry.id}`}
          className="source-control-branch-tab" aria-selected={tab === entry.id} aria-controls={`branch-panel-${entry.id}`}
          disabled={busy} onClick={() => setTab(entry.id)}>
          {entry.label}
        </button>
      ))}
    </div>

    {error && <p role="alert" className="source-control-branch-error">{error}</p>}
    {(!data || busy) && !error && <p className="source-control-loading-state" role="status"><LoaderCircle size={15} />{busy ? "Updating…" : "Loading…"}</p>}

    {data && tab === "branches" && (
      <div className="source-control-branch-tabpanel" role="tabpanel" id="branch-panel-branches" aria-labelledby="branch-tab-branches">
        <form className="source-control-branch-create" onSubmit={(event) => { event.preventDefault(); void change("create", name.trim()); }}>
          <label className="source-control-visually-hidden" htmlFor="new-local-branch">New branch name</label>
          <input id="new-local-branch" value={name} maxLength={1024} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="New branch name" />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !name.trim()}>Create branch</button>
        </form>
        <div className="source-control-branch-list">
          {data.branches.length === 0 && <p>No local branches yet.</p>}
          {data.branches.map((branch) => <div className="source-control-branch-row" key={branch.name}>
            <span className="source-control-branch-name" title={branch.name}>
              {branch.name}
              {branch.current && <small className="source-control-branch-track"> · current</small>}
              {branch.checkedOut && <small className="source-control-branch-track"> · other worktree</small>}
              {branch.upstream && <small className="source-control-branch-track"> · {branch.upstream}</small>}
            </span>
            <span className="source-control-row-actions">
              <button type="button" className="btn-ghost btn-sm" aria-label={`Checkout ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("checkout", branch.name)}>Checkout</button>
              <button type="button" className="btn-ghost btn-sm" aria-label={`Merge ${branch.name} into ${data.current ?? "current branch"}`} disabled={busy || branch.current || !data.current} onClick={() => void change("merge", branch.name)}>Merge</button>
              <button type="button" className="btn-ghost btn-sm source-control-danger" aria-label={`Delete ${branch.name}`} disabled={busy || branch.checkedOut} onClick={() => void change("delete", branch.name)}>Delete</button>
            </span>
          </div>)}
        </div>
      </div>
    )}

    {data && tab === "remotes" && (
      <div className="source-control-branch-tabpanel" role="tabpanel" id="branch-panel-remotes" aria-labelledby="branch-tab-remotes">
        {!data.remotes?.length && <p>No remotes configured.</p>}
        {data.remotes?.map((remote) => <div className="source-control-remote" key={remote.name}>
          <div className="source-control-remote-head">
            <strong className="source-control-remote-name">{remote.name}</strong>
            <button type="button" className="source-control-remote-url" title="Change URL"
              aria-label={`Change URL for remote ${remote.name}`} disabled={busy} onClick={() => startRemoteEdit(remote)}>
              <span className="source-control-remote-url-text">{remote.fetchUrls[0] ?? ""}</span>
              <Pencil size={12} />
            </button>
            <button type="button" className="btn-ghost btn-sm" aria-label={`Rename remote ${remote.name}`} disabled={busy} onClick={() => { setEditingRemote(null); setRenamingRemote(remote.name); setNewRemoteName(remote.name); }}>Rename</button>
          </div>
          {remote.fetchUrls.length > 1 && remote.fetchUrls.slice(1).map((url, index) =>
            <code className="source-control-remote-url-line" key={`fetch:${index}`}>{url}</code>)}
          {remote.pushUrls.filter((url) => !remote.fetchUrls.includes(url)).map((url, index) =>
            <code className="source-control-remote-url-line" key={`push:${index}`}>push · {url}</code>)}

          {editingRemote === remote.name && <form className="source-control-remote-form" onSubmit={changeRemoteUrl}>
            <label className="source-control-field">
              <span className="source-control-field-label">Fetch URL</span>
              <input id={`edit-remote-url-${remote.name}`} value={editFetchUrl} maxLength={2048} disabled={busy}
                onChange={(event) => setEditFetchUrl(event.target.value)} placeholder="https://github.com/user/repo.git" />
            </label>
            <label className="source-control-inline-check">
              <input type="checkbox" checked={editSeparatePush} disabled={busy}
                onChange={(event) => { setEditSeparatePush(event.target.checked); if (event.target.checked && !editPushUrl) setEditPushUrl(editFetchUrl); }} />
              Separate push URL
            </label>
            {editSeparatePush && (
              <label className="source-control-field">
                <span className="source-control-field-label">Push URL</span>
                <input id={`edit-remote-push-url-${remote.name}`} value={editPushUrl} maxLength={2048} disabled={busy}
                  onChange={(event) => setEditPushUrl(event.target.value)} placeholder="https://github.com/user/repo.git" />
              </label>
            )}
            <div className="source-control-remote-form-actions">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !editFetchUrl.trim() || (editSeparatePush && !editPushUrl.trim())}>Save URL</button>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setEditingRemote(null)}>Cancel</button>
            </div>
          </form>}

          {renamingRemote === remote.name && <form className="source-control-remote-form" onSubmit={renameRemote}>
            <label className="source-control-field">
              <span className="source-control-field-label">Remote name</span>
              <input id="rename-remote" value={newRemoteName} maxLength={256} disabled={busy}
                onChange={(event) => setNewRemoteName(event.target.value)} />
            </label>
            <div className="source-control-remote-form-actions">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !newRemoteName.trim() || newRemoteName.trim() === remote.name}>Save remote name</button>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setRenamingRemote(null)}>Cancel</button>
            </div>
          </form>}
        </div>)}

        {addingRemote ? (
          <form className="source-control-remote-form" onSubmit={addRemote}>
            <label className="source-control-field">
              <span className="source-control-field-label">Name</span>
              <input id="new-remote-name" value={remoteName} maxLength={256} disabled={busy}
                onChange={(e) => setRemoteName(e.target.value)} placeholder="origin" />
            </label>
            <label className="source-control-field">
              <span className="source-control-field-label">URL</span>
              <input id="new-remote-url" value={remoteUrl} maxLength={2048} disabled={busy}
                onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
            </label>
            <div className="source-control-remote-form-actions">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !remoteName.trim() || !remoteUrl.trim()}>Add remote</button>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setAddingRemote(false); setRemoteName(""); setRemoteUrl(""); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-ghost btn-sm source-control-add-remote" disabled={busy} onClick={() => setAddingRemote(true)}>
            <Plus size={14} /> Add remote
          </button>
        )}
      </div>
    )}

    {data && tab === "upstream" && (
      <div className="source-control-branch-tabpanel" role="tabpanel" id="branch-panel-upstream" aria-labelledby="branch-tab-upstream">
        <p className="source-control-branch-status">
          {currentUpstream ? `Tracking: ${currentUpstream}` : "No upstream branch configured."}
        </p>
        <div className="source-control-remote-form">
          <label className="source-control-visually-hidden" htmlFor="upstream-remote">Upstream remote</label>
          <select id="upstream-remote" aria-label="Upstream remote" value={upstreamRemote} disabled={busy || !data.current}
            onChange={(event) => { setUpstreamRemote(event.target.value); setUpstreamBranch(data.current ?? ""); }}>
            <option value="">Select remote…</option>
            {data.remotes?.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
          </select>
          <label className="source-control-visually-hidden" htmlFor="upstream-branch">Remote branch</label>
          <input id="upstream-branch" aria-label="Remote branch" list="upstream-branches" value={upstreamBranch} maxLength={1024}
            disabled={busy || !data.current || !upstreamRemote} onChange={(event) => setUpstreamBranch(event.target.value)} placeholder={data.current ?? "main"} />
          <datalist id="upstream-branches">{data.remoteBranches?.filter((branch) => branch.remote === upstreamRemote).map((branch) => <option key={branch.name} value={branch.name} />)}</datalist>
          <div className="source-control-remote-form-actions">
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Set upstream" disabled={busy || !data.current || !knownTarget} onClick={() => void updateUpstream("set")}>Set</button>
            <button type="button" className="btn btn-primary btn-sm" aria-label="Publish and set upstream" disabled={busy || !data.current || !upstreamRemote || !upstreamBranch.trim()} onClick={() => void updateUpstream("publish")}>Publish</button>
            <button type="button" className="btn-ghost btn-sm source-control-danger" aria-label="Unset upstream" disabled={busy || !data.current || !currentUpstream} onClick={() => void updateUpstream("unset")}>Unset</button>
          </div>
        </div>
      </div>
    )}
  </AppModal>;
}
