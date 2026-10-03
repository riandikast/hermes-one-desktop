import { useMemo } from "react";
import {
  renderDiffLines,
  diffStat,
  type DiffRenderLine,
} from "./diffHighlight";

/**
 * Syntax-highlighted unified diff viewer (VS Code style).
 *
 * Renders three columns per line — old line no, new line no, code — with the
 * +/- background tint on the code cell only, and syntax colouring inside the
 * line so an edit reads as source, not as a wall of red/green. The tokenizer
 * lives in diffHighlight.ts (pure, unit-tested); this is presentation only.
 */
export function DiffViewer({
  raw,
  path,
  staged,
  emptyText = "Select a file to see its diff",
}: {
  raw: string;
  path?: string | null;
  staged?: boolean;
  emptyText?: string;
}): React.JSX.Element {
  const lines = useMemo(() => renderDiffLines(raw), [raw]);
  const stat = useMemo(() => diffStat(lines), [lines]);

  if (!raw.trim()) {
    return <div className="diff-viewer-empty">{emptyText}</div>;
  }

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-viewer-file" title={path ?? undefined}>
          {path ? path.split(/[\\/]/).pop() : ""}
        </span>
        {staged && <span className="diff-viewer-badge">staged</span>}
        <span className="diff-viewer-stat">
          <span className="diff-viewer-stat-add">+{stat.added}</span>
          <span className="diff-viewer-stat-del">-{stat.removed}</span>
        </span>
      </div>
      <div className="diff-viewer-body">
        {lines.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

function DiffRow({ line }: { line: DiffRenderLine }): React.JSX.Element {
  const cls = `diff-line diff-line--${line.kind}`;

  // Hunk headers and file metadata are diff plumbing: render them plainly,
  // never with syntax tokens (the tokenizer would colour `@@` as operators).
  if (line.kind === "hunk" || line.kind === "meta") {
    return (
      <div className={cls}>
        <span className="diff-gutter diff-gutter--old" />
        <span className="diff-gutter diff-gutter--new" />
        <span className="diff-code">{line.raw}</span>
      </div>
    );
  }

  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";

  return (
    <div className={cls}>
      <span className="diff-gutter diff-gutter--old">{line.oldLine ?? ""}</span>
      <span className="diff-gutter diff-gutter--new">{line.newLine ?? ""}</span>
      <span className="diff-marker" aria-hidden="true">
        {marker}
      </span>
      <span className="diff-code">
        {line.tokens.length === 0
          ? line.body
          : line.tokens.map((tok, k) => (
              <span key={k} className={`tok tok--${tok.kind}`}>
                {tok.text}
              </span>
            ))}
      </span>
    </div>
  );
}
