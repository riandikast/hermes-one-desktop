import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import type { FileChange } from "./types";

function diffStats(change: FileChange): string {
  if (change.before === null && change.after !== null) {
    return change.beforeKnown ? "Created" : "Edited";
  }
  if (change.before !== null && change.after === null) return "Deleted";
  const beforeLines = (change.before ?? "").split("\n").length;
  const afterLines = (change.after ?? "").split("\n").length;
  const added = Math.max(0, afterLines - beforeLines);
  const removed = Math.max(0, beforeLines - afterLines);
  return `+${added} −${removed} lines`;
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
              <div className="file-changes-diff-panes">
                <div className="file-changes-pane">
                  <div className="file-changes-pane-title">Before</div>
                  <ReadOnlyCode content={selected.before ?? ""} />
                </div>
                <div className="file-changes-pane">
                  <div className="file-changes-pane-title">After</div>
                  <ReadOnlyCode content={selected.after ?? ""} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}