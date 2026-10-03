/**
 * Lane layout for the Source Control commit graph (VS Code style).
 *
 * Pure and deterministic: given a topologically ordered commit list (children
 * before parents, which `git log --topo-order` guarantees), assign each commit
 * a lane and emit the edges to draw. Deliberately free of React and the DOM so
 * the tricky part — lane reuse — is unit-testable without a browser.
 *
 * Algorithm: walk commits newest-first maintaining `lanes`, an array where
 * `lanes[i]` is the hash of the commit the lane at column `i` is currently
 * "waiting for" (the next unvisited ancestor). A commit takes the leftmost lane
 * already waiting for it; if none does, it opens a new lane. Its lane is then
 * reassigned to its first parent, and any extra parents (a merge) open new
 * lanes. Lanes that no longer wait for anything are dropped.
 */

export interface GraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  subject: string;
}

export interface GraphNode {
  commit: GraphCommit;
  /** Column index (0-based) where the commit dot sits. */
  lane: number;
  /** Total lanes in play at this row, for sizing the gutter. */
  laneCount: number;
  /** Edges entering this commit from the row above (parents still pending). */
  incoming: GraphEdge[];
  /** Edges this commit starts toward its parents (drawn between this row and below). */
  outgoing: GraphEdge[];
}

export interface GraphEdge {
  /** Source lane (the commit's lane, or the lane it was waiting on). */
  fromLane: number;
  /** Target lane in the row below. */
  toLane: number;
  /** Hash the edge leads to (parent); used to colour by branch line. */
  toHash: string;
  /** True when this edge merges two lines (a merge commit's second+ parent). */
  merge: boolean;
}

/**
 * Lay out the graph. Returns one node per commit, in the same order as input.
 */
export function layoutGraph(commits: GraphCommit[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  // lanes[i] = hash the lane at column i is waiting for, or null if free.
  const lanes: (string | null)[] = [];

  const findFreeLane = (): number => {
    const idx = lanes.indexOf(null);
    if (idx >= 0) return idx;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    // Edges arriving at this row: every lane waiting for this commit.
    const incoming: GraphEdge[] = [];
    let lane = -1;
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] === commit.hash) {
        if (lane === -1) lane = i;
        else
          incoming.push({
            fromLane: i,
            toLane: i,
            toHash: commit.hash,
            merge: true,
          });
      }
    }
    if (lane === -1) {
      // Nothing was waiting for this commit — it starts a new line (a branch
      // tip or the first commit of the walk).
      lane = findFreeLane();
    }

    const laneCount = Math.max(lanes.length, 1);

    // The commit claims its lane; free the other lanes that converged here
    // (their line merges into this one).
    for (let i = 0; i < lanes.length; i += 1) {
      if (i !== lane && lanes[i] === commit.hash) lanes[i] = null;
    }

    // Assign parents. The first parent continues in this lane (so the mainline
    // stays a straight column); extra parents (merges) take other lanes.
    const outgoing: GraphEdge[] = [];
    if (commit.parents.length === 0) {
      lanes[lane] = null;
    } else {
      let parentsAssigned = 0;
      for (const parent of commit.parents) {
        const existing = lanes.indexOf(parent);
        if (parentsAssigned === 0) {
          // First parent inherits this commit's lane unless another lane
          // already waits for it (then we merge into that column).
          if (existing >= 0 && existing !== lane) {
            lanes[lane] = null;
            outgoing.push({
              fromLane: lane,
              toLane: existing,
              toHash: parent,
              merge: false,
            });
            parentsAssigned += 1;
            continue;
          }
          lanes[lane] = parent;
          outgoing.push({
            fromLane: lane,
            toLane: lane,
            toHash: parent,
            merge: false,
          });
          parentsAssigned += 1;
          continue;
        }
        // Additional parents: reuse an existing lane waiting for them, or open
        // a new one. This is the merge edge that fans out to the right.
        const target = existing >= 0 ? existing : findFreeLane();
        lanes[target] = parent;
        outgoing.push({
          fromLane: lane,
          toLane: target,
          toHash: parent,
          merge: true,
        });
      }
    }

    nodes.push({
      commit,
      lane,
      laneCount: Math.max(laneCount, lane + 1, lanes.length),
      incoming,
      outgoing,
    });
  }

  // A second pass fixes laneCount now that all lanes are known (the gutter
  // must be as wide as the widest row, not just the row's own width).
  const maxLane = nodes.reduce((m, n) => Math.max(m, n.laneCount), 1);
  for (const n of nodes) n.laneCount = maxLane;

  return nodes;
}

/**
 * Colour index for a lane. Kept bounded so the palette is finite; lanes
 * alternate through it as the graph deepens.
 */
export function laneColor(lane: number): number {
  return lane % 8;
}

/** Render an ISO date as a compact relative string ("3h ago", "2d ago"). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
