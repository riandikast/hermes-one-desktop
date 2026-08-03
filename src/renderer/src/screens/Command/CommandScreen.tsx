import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pencil,
  Plus,
  Save,
  Trash2,
  Folder,
  X,
  ChevronDown,
  ChevronRight,
  Search,
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
  folder: string;
  createdAt: number;
  updatedAt: number;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}`;
}

const EMPTY_FORM = { name: "", command: "", description: "", cwd: "", folder: "" };
const TERMINAL_HEIGHT_KEY = "hermes.commands.terminalHeight";
const MIN_DOCK_HEIGHT = 120;
const MAX_DOCK_HEIGHT = 640;

export function CommandScreen(): React.JSX.Element {
  const { t } = useI18n();
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [editing, setEditing] = useState<CommandItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dockHeight, setDockHeight] = useState(() => {
    try {
      const raw = localStorage.getItem(TERMINAL_HEIGHT_KEY);
      const parsed = raw ? Number(raw) : 260;
      return Number.isFinite(parsed)
        ? Math.min(MAX_DOCK_HEIGHT, Math.max(MIN_DOCK_HEIGHT, parsed))
        : 260;
    } catch {
      return 260;
    }
  });
  const dockRef = useRef<TerminalDockHandle | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const resizeRef = useRef<{
    startY: number;
    startHeight: number;
    container: HTMLElement | null;
  }>({ startY: 0, startHeight: 0, container: null });

  const refresh = useCallback(async () => {
    try {
      const list = await window.hermesAPI.listCommands();
      setCommands(
        (list as CommandItem[]).map((c) => ({ ...c, folder: c.folder ?? "" })),
      );
    } catch {
      setCommands([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const c of commands) if (c.folder) set.add(c.folder);
    return Array.from(set).sort();
  }, [commands]);

  const visibleCommands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q),
    );
  }, [commands, search]);

  const grouped = useMemo(() => {
    const result: { folder: string; items: CommandItem[] }[] = [];
    for (const f of folders) {
      result.push({ folder: f, items: [] });
    }
    result.push({ folder: "", items: [] });
    for (const c of visibleCommands) {
      const group = result.find((g) => g.folder === c.folder);
      group?.items.push(c);
    }
    return result.filter((g) => g.items.length > 0 || g.folder !== "");
  }, [folders, visibleCommands]);

  const startNew = (): void => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, folder: "" });
    setNewFolderMode(false);
    setShowEditor(true);
  };

  const closeEditor = (): void => {
    setShowEditor(false);
  };

  const startEdit = (cmd: CommandItem): void => {
    setEditing(cmd);
    setForm({
      name: cmd.name,
      command: cmd.command,
      description: cmd.description,
      cwd: cmd.cwd,
      folder: cmd.folder ?? "",
    });
    setNewFolderMode(false);
    setShowEditor(true);
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
    let folder = form.folder;
    if (newFolderMode && newFolderName.trim()) folder = newFolderName.trim();
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
        folder,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      });
      setForm({ ...EMPTY_FORM });
      setEditing(null);
      setNewFolderMode(false);
      setShowEditor(false);
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
      setNewFolderMode(false);
      setShowEditor(false);
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

  // Drag a command row onto a folder header to move it into that folder.
  const moveToFolder = async (cmdId: string, folder: string): Promise<void> => {
    const cmd = commands.find((c) => c.id === cmdId);
    if (!cmd || (cmd.folder ?? "") === folder) return;
    try {
      await window.hermesAPI.saveCommand({
        ...cmd,
        folder,
        updatedAt: Date.now(),
      });
      await refresh();
    } catch {
      setError("Failed to move command.");
    }
  };

  const toggleFolder = (folder: string): void => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    const container = e.currentTarget.parentElement;
    if (!container) return;
    resizeRef.current = {
      startY: e.clientY,
      startHeight: container.getBoundingClientRect().height,
      container,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const { startY, startHeight, container } = resizeRef.current;
    if (!container) return;
    const delta = startY - e.clientY; // drag up = grow
    const next = Math.min(
      MAX_DOCK_HEIGHT,
      Math.max(MIN_DOCK_HEIGHT, startHeight + delta),
    );
    setDockHeight(next);
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeRef.current.container = null;
  };

  const selectFolderValue = form.folder;

  return (
    <div className="command-page">
      <div className="command-main">
        <div className="command-list-header">
          <h2>{t("navigation.commands")}</h2>
          <div className="command-list-actions">
            <div className="command-search">
              <Search size={13} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search commands…"
                aria-label="Search commands"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={startNew}
            >
              <Plus size={13} /> New
            </button>
          </div>
        </div>

        {error && <div className="command-error">{error}</div>}

        {commands.length === 0 ? (
          <div className="command-empty">
            <p>No commands saved yet.</p>
            <p className="command-empty-hint">
              Save a command, then click Run to execute it in the built-in terminal.
            </p>
          </div>
        ) : visibleCommands.length === 0 ? (
          <div className="command-empty">
            <p>No commands match “{search}”.</p>
          </div>
        ) : (
          <div className="command-groups">
            {grouped.map(({ folder, items }) => {
              const collapsed = collapsedFolders.has(folder);
              const label = folder || "Ungrouped";
              return (
                <div
                  key={folder || "__ungrouped__"}
                  className={`command-group ${folder ? "" : "command-group--ungrouped"}`}
                >
                  <button
                    type="button"
                    className="command-group-header"
                    onClick={() => toggleFolder(folder)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const src = dragIdRef.current;
                      if (src) void moveToFolder(src, folder);
                      dragIdRef.current = null;
                    }}
                    title={folder ? `Move command to ${label}` : "Move to Ungrouped"}
                  >
                    {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="command-group-label">
                      {folder ? <Folder size={12} /> : <span className="command-group-dot" />}
                      {label}
                    </span>
                    <span className="command-group-count">{items.length}</span>
                  </button>
                  {!collapsed && (
                    <ul className="command-list">
                      {items.map((cmd) => (
                        <li
                          key={cmd.id}
                          className={`command-row ${editing?.id === cmd.id ? "editing" : ""}`}
                          draggable={true}
                          onDragStart={(e) => {
                            dragIdRef.current = cmd.id;
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragIdRef.current = null;
                          }}
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
              );
            })}
          </div>
        )}
      </div>

      {showEditor && (
        <div className="command-editor">
          <div className="command-editor-header">
            <span>{editing ? "Edit command" : "New command"}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={closeEditor}
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
              <span>Folder</span>
              {newFolderMode ? (
                <div className="command-cwd-row">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setNewFolderMode(false);
                      setNewFolderName("");
                    }}
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="command-cwd-row">
                  <select
                    value={selectFolderValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__new__") {
                        setNewFolderMode(true);
                        setNewFolderName("");
                        setForm((f) => ({ ...f, folder: "" }));
                      } else {
                        setForm((f) => ({ ...f, folder: v }));
                      }
                    }}
                  >
                    <option value="">Ungrouped</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                    <option value="__new__">＋ New folder…</option>
                  </select>
                </div>
              )}
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

      <TerminalDock
        ref={dockRef}
        onNewSession={onNewSession}
        dockHeight={dockHeight}
        onResizeStart={onResizeStart}
        onResizeMove={onResizeMove}
        onResizeEnd={onResizeEnd}
      />
    </div>
  );
}
