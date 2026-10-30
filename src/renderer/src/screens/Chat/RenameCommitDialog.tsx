import { useRef, useState } from "react";
import { X } from "lucide-react";
import { AppModal, AppModalTitle, AppModalDescription } from "../../components/modal/AppModal";

export function RenameCommitDialog({ initialMessage, hash, onClose, onRename }: {
  initialMessage: string; hash: string; onClose: () => void; onRename: (message: string) => Promise<void>;
}): React.JSX.Element {
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  return <AppModal open onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="source-control-branches" overlayClassName="source-control-branches-overlay" describedBy="rename-description">
    <div className="source-control-branches-header"><AppModalTitle>Rename commit</AppModalTitle><button type="button" className="btn-ghost" aria-label="Close rename commit" disabled={busy} onClick={onClose}><X size={16} /></button></div>
    <AppModalDescription id="rename-description">Latest unpublished commit only. Renaming rewrites its commit ID. Remote heads and tags are verified before saving; no push occurs.</AppModalDescription>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (saving.current || !message.trim()) return;
      if (!window.confirm(`Rename commit ${hash.slice(0, 7)}? This rewrites its commit ID. No push will occur.`)) return;
      saving.current = true; setBusy(true);
      void onRename(message).then(onClose).catch((err) => { setError(String(err)); saving.current = false; setBusy(false); });
    }}>
      <label htmlFor="rename-commit-message">Commit message</label>
      <textarea id="rename-commit-message" className="source-control-commit-input" rows={5} maxLength={16384} value={message} disabled={busy} autoFocus onChange={(event) => setMessage(event.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      <button type="submit" className="btn-ghost btn-sm" disabled={busy || !message.trim()}>{busy ? "Renaming…" : "Save message"}</button>
    </form>
  </AppModal>;
}
