import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { diffLines, type DiffLine } from "./fileChanges";
import { countDiffLineStats, parseDiff } from "./diffLines";
import type { FileChange } from "./types";

function diffStats(change: FileChange): React.JSX.Element {
  if (change.diff) {
    const stats = countDiffLineStats(change.diff);
    return (
      <span>
        <span className="file-changes-stat-del">-{stats.removed}</span>{" "}
        <span className="file-changes-stat-add">+{stats.added}</span>
      </span>
    );
  }
  if (change.before === null && change.after !== null && change.beforeKnown) {
    return <span>Created</span>;
  }
  if (change.before !== null && change.after === null) {
    return <span>Deleted</span>;
  }
  if (change.removed || change.added) {
    return (
      <span>
        <span className="file-changes-stat-del">-{change.removed?.length ?? 0}</span>{" "}
        <span className="file-changes-stat-add">+{change.added?.length ?? 0}</span>
      </span>
    );
  }
  if (change.before !== null && change.after !== null) {
    const computed = diffLines(change.before, change.after);
    if (computed) {
      const del = computed.filter((l) => l.type === "del").length;
      const add = computed.filter((l) => l.type === "add").length;
      return (
        <span>
          <span className="file-changes-stat-del">-{del}</span>{" "}
          <span className="file-changes-stat-add">+{add}</span>
        </span>
      );
    }
  }
  return <span>Edited</span>;
}

function ReadOnlyCode({ content }: { content: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: [oneDark, EditorView.editable.of(false)],
      }),
    });
    return () => view.destroy();
  }, [content]);
  return <div ref={hostRef} className="file-changes-code" />;
}

/** Build the git-style diff lines for a change: the backend's unified diff
 *  when present (authoritative), else the exact hunk from the tool's
 *  old/new strings, else a computed LCS diff over full contents, else null
 *  (after-only view). */
function diffFor(change: FileChange): DiffLine[] | null {
  if (change.diff) {
    // Map the unified-diff kinds (add/remove/context) onto the dialog's
    // existing DiffLine shape (add/del/same).
    return parseDiff(change.diff).map((line) => ({
      type:
        line.kind === "add"
          ? ("add" as const)
          : line.kind === "remove"
            ? ("del" as const)
            : ("same" as const),
      text: line.text,
    }));
  }
  if (change.removed || change.added) {
    const lines: DiffLine[] = [];
    for (const r of change.removed ?? []) lines.push({ type: "del", text: r });
    for (const a of change.added ?? []) lines.push({ type: "add", text: a });
    return lines;
  }
  if (change.before !== null && change.after !== null) {
    return diffLines(change.before, change.after);
  }
  return null;
}

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  return (
    <div className="file-changes-diff-body">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`file-changes-diff-line file-changes-diff-${line.type}`}
        >
          <span className="file-changes-diff-marker">
            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
          </span>
          <span className="file-changes-diff-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

export function FileChangesDialog({
  changes,
  onClose,
}: {
  changes: FileChange[];
  onClose: () => void;
}): React.JSX.Element {
  const [selectedPath, setSelectedPath] = useState<string>(changes[0]?.path ?? "");
  const selected = changes.find((c) => c.path === selectedPath) ?? changes[0];

  const fileName = useMemo(
    () => selectedPath.split(/[\\/]/).pop() || selectedPath,
    [selectedPath],
  );

  const diff = useMemo(
    () => (selected ? diffFor(selected) : null),
    [selected],
  );

  return (
    <div className="file-changes-overlay" onClick={onClose}>
      <div className="file-changes-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="file-changes-header">
          <span className="file-changes-title">File changes</span>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="file-changes-body">
          <div className="file-changes-list">
            {changes.map((c) => (
              <button
                key={c.path}
                type="button"
                className={`file-changes-item ${c.path === selectedPath ? "active" : ""}`}
                onClick={() => setSelectedPath(c.path)}
                title={c.path}
              >
                <span className="file-changes-item-name">
                  {c.path.split(/[\\/]/).pop() || c.path}
                </span>
                <span className="file-changes-item-stats">{diffStats(c)}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="file-changes-diff">
              <div className="file-changes-diff-header">
                <span className="file-changes-diff-file">{fileName}</span>
                <span className="file-changes-diff-stats">{diffStats(selected)}</span>
              </div>
              {diff ? (
                <DiffView lines={diff} />
              ) : (
                <div className="file-changes-after-only">
                  <div className="file-changes-pane-title">After</div>
                  <ReadOnlyCode content={selected.after ?? ""} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
