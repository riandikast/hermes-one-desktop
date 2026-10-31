import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  GitStashEntry,
  GitStashFile,
  GitStashFileSelection,
} from "../../../../shared/git-stash";

type ActionResult = { ok: boolean; output?: string; error?: string };
type StashGroup = GitStashEntry & { files: GitStashFile[] };
const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^(?:Error: )+/, "");
const key = (hash: string, path: string): string =>
  JSON.stringify([hash, path]);
const statusLabel = (status: string): string =>
  ({ M: "Modified", A: "Added", D: "Deleted", R: "Renamed", "?": "Untracked" })[
    status
  ] ?? status;

export function StashSection({
  dir,
  revision,
  busy,
  run,
  onPreview,
}: {
  dir: string;
  revision: number;
  busy: boolean;
  run: (action: () => Promise<ActionResult>, label: string) => Promise<void>;
  onPreview: (raw: string, label: string) => void;
}): React.JSX.Element {
  const [groups, setGroups] = useState<StashGroup[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void (async () => {
      const result = await window.hermesAPI.gitStashList(dir);
      if (!result.ok) throw new Error(result.error ?? "Stashes unavailable");
      const next: StashGroup[] = [];
      const failures: string[] = [];
      // Bound simultaneous Git processes; never fan out across every stash.
      for (const entry of result.entries) {
        if (!alive) return;
        try {
          const files = await window.hermesAPI.gitStashFiles(dir, entry.hash);
          if (!files.ok) throw new Error(files.error ?? "Saved files unavailable");
          next.push({ ...entry, files: files.files });
        } catch (err) {
          failures.push(`${entry.ref}: ${errorMessage(err)}`);
        }
      }
      if (!alive) return;
      setGroups(next);
      setError(failures.join("\n"));
      const keys = new Set(
        next.flatMap((entry) =>
          entry.files.map((file) => key(entry.hash, file.path)),
        ),
      );
      setSelection((previous) => previous.filter((item) => keys.has(item)));
      setActive((previous) =>
        previous && keys.has(previous) ? previous : null,
      );
      if (anchor.current && !keys.has(anchor.current)) anchor.current = null;
    })()
      .catch((err: unknown) => {
        if (alive) {
          setError(errorMessage(err));
          setGroups([]);
          setSelection([]);
          anchor.current = null;
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      previewRequest.current++;
    };
  }, [dir, revision]);

  const allKeys = groups.flatMap((group) => group.files.map((file) => key(group.hash, file.path)));
  const selectionToggle = (keys: string[], label: string): React.JSX.Element => {
    const allSelected = keys.length > 0 && keys.every((item) => selection.includes(item));
    return <button type="button" className="btn-ghost btn-sm"
      aria-label={`${allSelected ? "Unselect" : "Select"} all ${label}`}
      aria-pressed={allSelected} disabled={busy || loading || !keys.length}
      onClick={() => {
        setSelection((previous) => keys.every((item) => previous.includes(item))
          ? previous.filter((item) => !keys.includes(item))
          : [...previous, ...keys.filter((item) => !previous.includes(item))]);
        if (anchor.current && keys.includes(anchor.current)) anchor.current = null;
      }}>{allSelected ? "Unselect all" : "Select all"}</button>;
  };
  const select = (group: StashGroup, path: string, shift: boolean): void => {
    if (busy || loading) return;
    const target = key(group.hash, path);
    const keys = group.files.map((file) => key(group.hash, file.path));
    const from = shift && anchor.current ? keys.indexOf(anchor.current) : -1;
    const to = keys.indexOf(target);
    setSelection((previous) => {
      if (from >= 0 && to >= 0) {
        const range = keys.slice(Math.min(from, to), Math.max(from, to) + 1);
        return [...previous.filter((item) => !range.includes(item)), ...range];
      }
      return previous.includes(target)
        ? previous.filter((item) => item !== target)
        : [...previous, target];
    });
    if (!shift || from < 0) anchor.current = target;
  };
  const act = (action: "restore" | "delete", keys: string[]): void => {
    if (busy || loading || !keys.length) return;
    const selections: GitStashFileSelection[] = [];
    for (const item of keys) {
      const [hash, path] = JSON.parse(item) as [string, string];
      const existing =
        selections.at(-1)?.hash === hash ? selections.at(-1) : undefined;
      if (existing) existing.paths.push(path);
      else selections.push({ hash, paths: [path] });
    }
    const question =
      action === "delete"
        ? `Permanently delete ${keys.length} selected saved file change(s)? Other saved files remain. This cannot be undone.`
        : `Restore ${keys.length} selected saved file change(s) to the working tree? Saved copies are kept. A clean working tree is required. Processing stops at the first failure. Restoring running development source may trigger reload or restart.`;
    if (!window.confirm(question)) return;
    void run(
      () =>
        action === "delete"
          ? window.hermesAPI.gitStashDeleteFiles(dir, selections)
          : window.hermesAPI.gitStashRestoreFiles(dir, selections),
      action === "delete"
        ? "Deleted saved file changes"
        : "Restored saved file changes",
    );
  };
  const preview = async (
    group: StashGroup,
    file: GitStashFile,
  ): Promise<void> => {
    const request = ++previewRequest.current;
    setActive(key(group.hash, file.path));
    try {
      const result = await window.hermesAPI.gitStashFileDiff(
        dir,
        group.hash,
        file.path,
      );
      if (request !== previewRequest.current) return;
      if (result.ok) {
        setError("");
        onPreview(result.output ?? "", file.path);
      } else setError(errorMessage(result.error ?? "Saved file diff unavailable"));
    } catch (err) {
      if (request === previewRequest.current) setError(errorMessage(err));
    }
  };
  const rows = (group: StashGroup): React.JSX.Element[] =>
    group.files.map((file) => {
      const id = key(group.hash, file.path),
        label = `${group.ref}: ${file.path}`;
      return (
        <div
          key={id}
          className={`source-control-file${selection.includes(id) ? " selected" : ""}${active === id ? " active" : ""}`}
        >
          <input
            type="checkbox"
            className="source-control-file-select"
            aria-label={`Select ${label}`}
            checked={selection.includes(id)}
            disabled={busy}
            onChange={(event) =>
              select(
                group,
                file.path,
                (event.nativeEvent as MouseEvent).shiftKey,
              )
            }
          />
          <button
            type="button"
            className="source-control-file-main"
            title={label}
            onClick={(event) => {
              if (event.shiftKey) select(group, file.path, true);
              else void preview(group, file);
            }}
          >
            <span className="source-control-file-name" title={file.path}>
              {file.path.split("/").pop()}
            </span>
            <span
              className="source-control-file-code"
              title={statusLabel(file.status)}
            >
              {file.status}
            </span>
          </button>
          <div className="source-control-file-actions">
            <span
              className="source-control-action-hint"
              title="View saved file diff"
            >
              <button
                type="button"
                className="source-control-stage-btn"
                aria-label={`View ${label}`}
                onClick={() => void preview(group, file)}
              >
                <Eye size={14} />
              </button>
            </span>
            <span
              className="source-control-action-hint"
              title="Restore saved file; keep saved copy"
            >
              <button
                type="button"
                className="source-control-stage-btn"
                disabled={busy}
                aria-label={`Restore ${label}`}
                onClick={() => act("restore", [id])}
              >
                <Plus size={14} />
              </button>
            </span>
            <span
              className="source-control-action-hint"
              title="Delete only this saved file change"
            >
              <button
                type="button"
                className="source-control-stage-btn"
                disabled={busy}
                aria-label={`Delete ${label}`}
                onClick={() => act("delete", [id])}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        </div>
      );
    });
  const chevrons = (
    <>
      <ChevronRight
        className="source-control-chevron-closed"
        size={14}
        aria-hidden="true"
      />
      <ChevronDown
        className="source-control-chevron-open"
        size={14}
        aria-hidden="true"
      />
    </>
  );
  return (
    <details className="source-control-section" open>
      <summary className="source-control-section-title">
        {chevrons}Stash (
        {groups.reduce((count, group) => count + group.files.length, 0)})
      </summary>
      <div className="source-control-section-toolbar">
        {selectionToggle(allKeys, "stash")}
        {selection.length > 0 && <>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || loading}
            onClick={() => act("restore", selection)}
          >
            Restore selected ({selection.length})
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || loading}
            onClick={() => act("delete", selection)}
          >
            Delete selected ({selection.length})
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              setSelection([]);
              anchor.current = null;
            }}
          >
            Clear stash selection
          </button>
        </>}
      </div>
      {loading && (
        <div className="source-control-empty worktree-loading" role="status">
          <LoaderCircle size={14} aria-hidden="true" />
          Loading saved files…
        </div>
      )}
      {error && (
        <div className="source-control-empty" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && groups.every((group) => !group.files.length) && (
        <div className="source-control-empty">No stashed files</div>
      )}
      {!loading &&
        groups.map((group) =>
          groups.length === 1 ? (
            <div key={group.hash}>{rows(group)}</div>
          ) : (
            <details key={group.hash} className="source-control-section" open>
              <summary
                className="source-control-section-title"
                title={group.subject}
              >
                {chevrons}
                {group.ref} ({group.files.length})
              </summary>
              <div className="source-control-section-toolbar">
                {selectionToggle(group.files.map((file) => key(group.hash, file.path)), group.ref)}
              </div>
              {rows(group)}
            </details>
          ),
        )}
    </details>
  );
}
