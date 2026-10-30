import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  LoaderCircle,
  Play,
  Trash2,
} from "lucide-react";
import type { GitStashEntry } from "../../../../shared/git-stash";

type ActionResult = { ok: boolean; output?: string; error?: string };

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
  const [entries, setEntries] = useState<GitStashEntry[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void Promise.resolve()
      .then(() => window.hermesAPI.gitStashList(dir))
      .then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setError(result.error ?? "Stashes unavailable");
          setEntries([]);
          setSelection([]);
          anchor.current = null;
          return;
        }
        setEntries(result.entries);
        setSelection((previous) =>
          previous.filter((hash) =>
            result.entries.some((entry) => entry.hash === hash),
          ),
        );
        if (!result.entries.some((entry) => entry.hash === anchor.current))
          anchor.current = null;
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(String(err));
          setEntries([]);
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

  const select = (hash: string, shift: boolean): void => {
    const from = shift
      ? entries.findIndex((entry) => entry.hash === anchor.current)
      : -1;
    const to = entries.findIndex((entry) => entry.hash === hash);
    setSelection((previous) => {
      if (from >= 0 && to >= 0) {
        const range = entries
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .map((entry) => entry.hash);
        return [...previous.filter((item) => !range.includes(item)), ...range];
      }
      return previous.includes(hash)
        ? previous.filter((item) => item !== hash)
        : [...previous, hash];
    });
    if (!shift || from < 0) anchor.current = hash;
  };
  const act = (action: "apply" | "drop", hashes: string[]): void => {
    if (busy || loading || !hashes.length) return;
    const labels = hashes
      .map((hash) => entries.find((entry) => entry.hash === hash)?.ref ?? hash)
      .join(", ");
    const question =
      action === "drop"
        ? `Permanently drop ${labels}? Saved changes will be lost. This cannot be undone.`
        : `Apply ${labels} in selection order? Conflicts may require manual resolution. Stashes are kept; processing stops at the first failure.`;
    if (!window.confirm(question)) return;
    void run(
      () =>
        action === "drop"
          ? window.hermesAPI.gitStashDrop(dir, hashes)
          : window.hermesAPI.gitStashApply(dir, hashes),
      action === "drop" ? "Dropped stashes" : "Applied stashes",
    );
  };
  const preview = async (entry: GitStashEntry): Promise<void> => {
    const request = ++previewRequest.current;
    try {
      const result = await window.hermesAPI.gitStashDiff(dir, entry.hash);
      if (request !== previewRequest.current) return;
      if (result.ok) {
        setError("");
        onPreview(result.output ?? "", entry.ref);
      } else setError(result.error ?? "Stash diff unavailable");
    } catch (err) {
      if (request === previewRequest.current) setError(String(err));
    }
  };
  return (
    <details className="source-control-section" open>
      <summary className="source-control-section-title">
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
        Stash ({entries.length})
      </summary>
      {selection.length > 0 && (
        <div className="source-control-section-toolbar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || loading}
            onClick={() => act("apply", selection)}
          >
            Apply selected ({selection.length})
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || loading}
            onClick={() => act("drop", selection)}
          >
            Drop selected ({selection.length})
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
        </div>
      )}
      {loading && (
        <div className="source-control-empty worktree-loading" role="status">
          <LoaderCircle size={14} aria-hidden="true" />
          Loading stashes…
        </div>
      )}
      {error && (
        <div className="source-control-empty" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <div className="source-control-empty">No stashes</div>
      )}
      {!loading &&
        entries.map((entry) => (
          <div
            key={entry.hash}
            className={`source-control-file${selection.includes(entry.hash) ? " selected" : ""}`}
          >
            <input
              type="checkbox"
              className="source-control-file-select"
              aria-label={`Select ${entry.ref}`}
              checked={selection.includes(entry.hash)}
              disabled={busy}
              onChange={(event) =>
                select(entry.hash, (event.nativeEvent as MouseEvent).shiftKey)
              }
            />
            <button
              type="button"
              className="source-control-file-main"
              title={`${entry.ref}: ${entry.subject}`}
              onClick={(event) => {
                if (event.shiftKey) select(entry.hash, true);
                else void preview(entry);
              }}
            >
              <span className="source-control-file-name">
                {entry.ref}: {entry.subject}
              </span>
            </button>
            <div className="source-control-file-actions">
              <span
                className="source-control-action-hint"
                title="View stash diff"
              >
                <button
                  type="button"
                  className="source-control-stage-btn"
                  aria-label={`View ${entry.ref}`}
                  onClick={() => void preview(entry)}
                >
                  <Eye size={14} />
                </button>
              </span>
              <span
                className="source-control-action-hint"
                title="Apply stash; keep saved copy"
              >
                <button
                  type="button"
                  className="source-control-stage-btn"
                  disabled={busy}
                  aria-label={`Apply ${entry.ref}`}
                  onClick={() => act("apply", [entry.hash])}
                >
                  <Play size={14} />
                </button>
              </span>
              <span
                className="source-control-action-hint"
                title="Permanently drop stash"
              >
                <button
                  type="button"
                  className="source-control-stage-btn"
                  disabled={busy}
                  aria-label={`Drop ${entry.ref}`}
                  onClick={() => act("drop", [entry.hash])}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          </div>
        ))}
    </details>
  );
}
