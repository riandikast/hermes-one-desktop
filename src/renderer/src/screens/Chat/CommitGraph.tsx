import { useMemo } from "react";
import { GitBranch, GitCommitHorizontal, GitMerge } from "lucide-react";
import {
  layoutGraph,
  laneColor,
  relativeTime,
  type GraphNode,
} from "./gitGraph";

/**
 * VS Code-style commit graph for the Source Control pane.
 *
 * The lane layout is computed by `layoutGraph` (pure, unit-tested); this file
 * only draws it. Graph lines are SVG so merges can curve; rows are plain DOM so
 * text selection and the click target behave normally.
 *
 * Geometry: each row is ROW_H tall and each lane LANE_W wide, so a node's
 * centre is (lane * LANE_W + LANE_W / 2, rowIndex * ROW_H + ROW_H / 2). Edges
 * are drawn from a row's bottom edge to the next row's top edge, curving when
 * they change lane — that is the shape that reads as a merge in VS Code.
 */

const ROW_H = 34;
const LANE_W = 14;
const DOT_R = 3.5;
/** Right padding after the last lane so dots don't clip the text column. */
const GUTTER_PAD = 10;

/** The 8 lane colours, tuned to be legible on both light and dark themes. */
const LANE_COLORS = [
  "var(--graph-lane-0)",
  "var(--graph-lane-1)",
  "var(--graph-lane-2)",
  "var(--graph-lane-3)",
  "var(--graph-lane-4)",
  "var(--graph-lane-5)",
  "var(--graph-lane-6)",
  "var(--graph-lane-7)",
];

function laneX(lane: number): number {
  return lane * LANE_W + LANE_W / 2;
}

/** Edge path from (x1, y1) to (x2, y2), curving only when the lane changes. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  // Cubic with vertical control points: leaves and arrives perpendicular, which
  // is what makes the branch/merge elbows read cleanly.
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraph({
  commits,
  onSelect,
  selectedHash,
  limit = 50,
}: {
  commits: import("./gitGraph").GraphCommit[];
  onSelect?: (commit: import("./gitGraph").GraphCommit) => void;
  selectedHash?: string | null;
  limit?: number;
}): React.JSX.Element {
  const nodes = useMemo(
    () => layoutGraph(commits.slice(0, limit)),
    [commits, limit],
  );

  if (nodes.length === 0) {
    return <div className="commit-graph-empty">No commits yet</div>;
  }

  const laneCount = nodes.reduce((m, n) => Math.max(m, n.laneCount), 1);
  const gutter = laneCount * LANE_W + GUTTER_PAD;
  const height = nodes.length * ROW_H;

  return (
    <div className="commit-graph" role="list">
      <div className="commit-graph-scroll">
        <div className="commit-graph-inner" style={{ height }}>
          {/* Edges layer: one SVG sized to the whole list. */}
          <svg
            className="commit-graph-svg"
            width={gutter}
            height={height}
            aria-hidden="true"
          >
            {nodes.map((node, row) => {
              const yTop = row * ROW_H + ROW_H / 2;
              const yNext = (row + 1) * ROW_H + ROW_H / 2;
              // Incoming: lines from the previous row converging into this dot.
              const incoming = node.incoming.map((edge, k) => (
                <path
                  key={`in-${row}-${k}`}
                  d={edgePath(
                    laneX(edge.fromLane),
                    yTop - ROW_H,
                    laneX(node.lane),
                    yTop,
                  )}
                  stroke={LANE_COLORS[laneColor(edge.fromLane)]}
                  className="commit-graph-edge"
                />
              ));
              // Outgoing: this dot down to each parent's lane in the next row.
              const outgoing = node.outgoing.map((edge, k) => (
                <path
                  key={`out-${row}-${k}`}
                  d={edgePath(
                    laneX(node.lane),
                    yTop,
                    laneX(edge.toLane),
                    yNext,
                  )}
                  stroke={LANE_COLORS[laneColor(edge.toLane)]}
                  className={
                    edge.merge
                      ? "commit-graph-edge commit-graph-edge--merge"
                      : "commit-graph-edge"
                  }
                />
              ));
              return (
                <g key={node.commit.hash}>
                  {incoming}
                  {outgoing}
                </g>
              );
            })}
            {/* Dots on top so an edge never covers a commit. */}
            {nodes.map((node, row) => (
              <circle
                key={`dot-${node.commit.hash}`}
                cx={laneX(node.lane)}
                cy={row * ROW_H + ROW_H / 2}
                r={DOT_R}
                fill="var(--graph-dot-bg)"
                stroke={LANE_COLORS[laneColor(node.lane)]}
                className={
                  selectedHash === node.commit.hash
                    ? "commit-graph-dot commit-graph-dot--selected"
                    : "commit-graph-dot"
                }
              />
            ))}
          </svg>

          {/* Text layer: subject, refs, meta. Positioned to the right of the gutter. */}
          <div className="commit-graph-rows" style={{ paddingLeft: gutter }}>
            {nodes.map((node, row) => (
              <CommitRow
                key={node.commit.hash}
                node={node}
                row={row}
                selected={selectedHash === node.commit.hash}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommitRow({
  node,
  row,
  selected,
  onSelect,
}: {
  node: GraphNode;
  row: number;
  selected: boolean;
  onSelect?: (commit: import("./gitGraph").GraphCommit) => void;
}): React.JSX.Element {
  const { commit } = node;
  const isMerge = commit.parents.length > 1;
  const isRoot = commit.parents.length === 0;
  return (
    <button
      type="button"
      role="listitem"
      className={`commit-graph-row${selected ? " commit-graph-row--selected" : ""}`}
      style={{ height: ROW_H, top: row * ROW_H }}
      onClick={() => onSelect?.(commit)}
      title={`${commit.shortHash} — ${commit.subject}`}
    >
      <span className="commit-graph-subject">
        {commit.subject || "(no message)"}
      </span>
      {commit.refs.length > 0 && (
        <span className="commit-graph-refs">
          {commit.refs.map((ref) => (
            <span key={ref} className="commit-graph-ref">
              <GitBranch size={10} /> {ref}
            </span>
          ))}
        </span>
      )}
      {isMerge && (
        <span
          className="commit-graph-tag commit-graph-tag--merge"
          title="Merge commit"
        >
          <GitMerge size={11} />
        </span>
      )}
      {isRoot && (
        <span className="commit-graph-tag" title="Root commit">
          <GitCommitHorizontal size={11} />
        </span>
      )}
      <span className="commit-graph-meta">
        <span className="commit-graph-author">{commit.author}</span>
        <span className="commit-graph-hash">{commit.shortHash}</span>
        <span className="commit-graph-date">{relativeTime(commit.date)}</span>
      </span>
    </button>
  );
}
