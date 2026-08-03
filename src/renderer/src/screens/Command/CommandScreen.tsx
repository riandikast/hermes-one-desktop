import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pencil,
  Plus,
  Save,
  Trash2,
  Folder,
  X,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { TerminalDockHandle } from "./TerminalDock";
import { TerminalDock } from "./TerminalDock";

export interface CommandItem {
  id: string;
  name: string;
  command: string;
  description: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}`;
}

const EMPTY_FORM = { name: "", command: "", description: "", cwd: "" };

export function CommandScreen(): React.JSX.Element {
  const { t } = useI18n();
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [editing, setEditing] = useState<CommandItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const dockRef = useRef<TerminalDockHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.hermesAPI.listCommands();
      setCommands(list as CommandItem[]);
    } catch {
      setCommands([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startNew = (): void => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (cmd: CommandItem): void => {
    setEditing(cmd);
    setForm({
      name: cmd.name,
      command: cmd.command,
      description: cmd.description,
      cwd: cmd.cwd,
    });
  };

  const pickCwd = async (): Promise<void> => {
    const dir = await window.hermesAPI.selectFolder();
    if (dir) setForm((f) => ({ ...f, cwd: dir }));
  };

  const save = async (): Promise<void> => {
    if (!form.name.trim() || !form.command.trim()) {
      setError("Name and command are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      await window.hermesAPI.saveCommand({
        id: editing?.id ?? newId(),
        name: form.name.trim(),
        command: form.command,
        description: form.description.trim(),
        cwd: form.cwd.trim(),
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      });
      setForm({ ...EMPTY_FORM });
      setEditing(null);
      await refresh();
    } catch {
      setError("Failed to save command.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await window.hermesAPI.deleteCommand(id);
    if (editing?.id === id) {
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    }
    await refresh();
  };

  const run = async (cmd: CommandItem): Promise<void> => {
    try {
      const { id } = await window.hermesAPI.commandRun({
        commandId: cmd.id,
        cwd: cmd.cwd,
        command: cmd.command,
      });
      dockRef.current?.attachSession(id, cmd.name);
    } catch {
      setError("Failed to start terminal session.");
    }
  };

  const onNewSession = async (): Promise<void> => {
    try {
      const { id } = await window.hermesAPI.terminalCreate({
        cwd: "",
        cols: 80,
        rows: 24,
      });
      dockRef.current?.attachSession(id, t("navigation.commands"));
    } catch {
      setError("Failed to start terminal session.");
    }
  };

  return (
    <div className="command-page">
      <div className="command-main">
        <div className="command-list-header">
          <h2>{t("navigation.commands")}</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={startNew}>
            <Plus size={13} /> New
          </button>
        </div>

        {error && <div className="command-error">{error}</div>}

        {commands.length === 0 ? (
          <div className="command-empty">
            <p>No commands saved yet.</p>
            <p className="command-empty-hint">
              Save a command, then click Run to execute it in the built-in terminal.
            </p>
          </div>
        ) : (
          <ul className="command-list">
            {commands.map((cmd) => (
              <li
                key={cmd.id}
                className={`command-row ${editing?.id === cmd.id ? "editing" : ""}`}
              >
                <button
                  type="button"
                  className="command-row-run"
                  onClick={() => void run(cmd)}
                  title={`Run ${cmd.name}`}
                  aria-label={`Run ${cmd.name}`}
                >
                  <Play size={14} />
                </button>
                <div className="command-row-body">
                  <div className="command-row-title">{cmd.name}</div>
                  <div className="command-row-desc">
                    {cmd.description ||
                      (cmd.cwd ? `cwd: ${cmd.cwd}` : "—")}
                  </div>
                  {cmd.cwd && (
                    <div className="command-row-cwd">cwd: {cmd.cwd}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="command-row-edit"
                  onClick={() => startEdit(cmd)}
                  title="Edit"
                  aria-label="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="command-row-delete"
                  onClick={() => void remove(cmd.id)}
                  title="Delete"
                  aria-label="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(editing !== null || form.name || form.command) && (
        <div className="command-editor">
          <div className="command-editor-header">
            <span>{editing ? "Edit command" : "New command"}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={startNew}
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>
          <div className="command-editor-fields">
            <label className="command-field">
              <span>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Build & run tests"
              />
            </label>
            <label className="command-field command-field--grow">
              <span>Command (multi-line supported)</span>
              <textarea
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder={"npm install\nnpm run build"}
                rows={5}
              />
            </label>
            <label className="command-field">
              <span>Description</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional — what this command does"
              />
            </label>
            <label className="command-field">
              <span>Working directory</span>
              <div className="command-cwd-row">
                <input
                  type="text"
                  value={form.cwd}
                  onChange={(e) => setForm((f) => ({ ...f, cwd: e.target.value }))}
                  placeholder="Optional — folder the command runs in"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void pickCwd()}
                  title="Browse…"
                  aria-label="Browse…"
                >
                  <Folder size={13} />
                </button>
              </div>
            </label>
          </div>
          <div className="command-editor-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void save()}
              disabled={loading}
            >
              <Save size={13} /> Save
            </button>
          </div>
        </div>
      )}

      <TerminalDock ref={dockRef} onNewSession={onNewSession} />
    </div>
  );
}
