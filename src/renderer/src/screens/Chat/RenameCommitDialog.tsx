import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { AppModal, AppModalTitle, AppModalDescription } from "../../components/modal/AppModal";

export function RenameCommitDialog({ dir, hash, onClose, onRename }: {
  dir: string; hash: string; onClose: () => void; onRename: (message: string) => Promise<void>;
}): React.JSX.Element {
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void window.hermesAPI.gitRenameCheck(dir, hash).then((result) => {
      if (!alive) return;
      if (!result.ok) setError(result.error ?? "Commit cannot be renamed");
      else { setMessage(result.output ?? ""); setReady(true); }
    }).catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [dir, hash]);
  return <AppModal open onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="source-control-branches" overlayClassName="source-control-branches-overlay" describedBy="rename-description">
    <div className="source-control-branches-header"><AppModalTitle>Rename commit</AppModalTitle><button type="button" className="btn-ghost" aria-label="Close rename commit" disabled={busy} onClick={onClose}><X size={16} /></button></div>
    <AppModalDescription id="rename-description">Latest unpublished commit only. Renaming rewrites its commit ID. Remote heads and tags are verified before saving; no push occurs.</AppModalDescription>
    {!ready && !error && <p role="status" className="source-control-loading-state"><LoaderCircle size={16} aria-hidden="true" />Checking local and remote history…</p>}
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (saving.current || !ready || !message.trim()) return;
      if (!window.confirm(`Rename commit ${hash.slice(0, 7)}? This rewrites its commit ID. No push will occur.`)) return;
      saving.current = true; setBusy(true);
      void onRename(message).then(onClose).catch((err) => { setError(String(err)); saving.current = false; setBusy(false); });
    }}>
      <label htmlFor="rename-commit-message">Commit message</label>
      <textarea id="rename-commit-message" className="source-control-commit-input" rows={5} maxLength={16384} value={message} disabled={!ready || busy} onChange={(event) => setMessage(event.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      <button type="submit" className="btn-ghost btn-sm" disabled={!ready || busy || !message.trim()}>{busy ? "Renaming…" : "Save message"}</button>
    </form>
  </AppModal>;
}
