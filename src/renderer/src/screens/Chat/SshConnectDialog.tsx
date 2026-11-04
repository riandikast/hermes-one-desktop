import { useState } from "react";
import { Server, Trash2 } from "lucide-react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import type { ExplorerSshConnection } from "../../../../shared/remote-path";

export interface SshConnectionInput {
  id?: string;
  label: string;
  host: string;
  port: number;
  username: string;
  keyPath: string;
}

/** Saved SSH hosts plus a small form; connection failures stay inline. */
export function SshConnectDialog({
  connections,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  connections: ExplorerSshConnection[];
  busy: boolean;
  error: string | null;
  onSave: (input: SshConnectionInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("22");
  const [label, setLabel] = useState("");
  const [keyPath, setKeyPath] = useState("");

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (busy || !host.trim() || !username.trim()) return;
    void onSave({
      label: label.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      keyPath: keyPath.trim(),
    });
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="explorer-name-dialog ssh-connect-dialog"
    >
      <AppModalTitle className="explorer-name-title">
        Connect to SSH host
      </AppModalTitle>
      <p className="ssh-connect-hint">
        Uses the system OpenSSH client. Leave the key empty to use your SSH
        agent or default keys.
      </p>
      <form className="ssh-connect-form" onSubmit={submit}>
        <label>
          <span>Host</span>
          <input
            className="explorer-name-input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="10.3.0.12"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label>
          <span>User</span>
          <input
            className="explorer-name-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="root"
            spellCheck={false}
          />
        </label>
        <label>
          <span>Port</span>
          <input
            className="explorer-name-input"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label>
          <span>Label</span>
          <input
            className="explorer-name-input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="ssh-connect-key">
          <span>Private key</span>
          <input
            className="explorer-name-input"
            value={keyPath}
            onChange={(event) => setKeyPath(event.target.value)}
            placeholder="C:/Users/you/.ssh/id_ed25519"
            spellCheck={false}
          />
        </label>
        {error && (
          <div className="explorer-name-error" role="alert">
            {error}
          </div>
        )}
        <div className="explorer-name-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !host.trim() || !username.trim()}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>

      {connections.length > 0 && (
        <div className="ssh-connect-saved">
          <div className="ssh-connect-saved-title">Saved hosts</div>
          {connections.map((connection) => (
            <div key={connection.id} className="ssh-connect-saved-row">
              <Server size={14} />
              <span className="ssh-connect-saved-name">
                {connection.label}
                <span className="ssh-connect-saved-host">
                  {connection.username}@{connection.host}:{connection.port}
                </span>
              </span>
              <button
                type="button"
                className="worktree-header-action"
                aria-label={`Forget ${connection.label}`}
                title="Forget this host"
                disabled={busy}
                onClick={() => void onDelete(connection.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </AppModal>
  );
}
