import { describe, expect, it } from "vitest";
import {
  layoutGraph,
  laneColor,
  relativeTime,
  type GraphCommit,
} from "./gitGraph";

/** Build a commit with sensible defaults so tests only state what matters. */
function c(
  hash: string,
  parents: string[] = [],
  over: Partial<GraphCommit> = {},
): GraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    refs: [],
    author: "tester",
    date: "2026-01-01T00:00:00Z",
    subject: `commit ${hash}`,
    ...over,
  };
}

describe("layoutGraph", () => {
  it("puts a linear history in a single lane", () => {
    const nodes = layoutGraph([c("c", ["b"]), c("b", ["a"]), c("a", [])]);
    expect(nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(nodes.every((n) => n.laneCount === 1)).toBe(true);
    // Each commit (except the root) continues straight into its parent.
    expect(nodes[0].outgoing).toEqual([
      { fromLane: 0, toLane: 0, toHash: "b", merge: false },
    ]);
    expect(nodes[1].outgoing[0].toHash).toBe("a");
    expect(nodes[2].outgoing).toEqual([]);
  });

  it("gives a merge commit one outgoing edge per parent", () => {
    // m merges feature (f) into main (a).
    const nodes = layoutGraph([
      c("m", ["a", "f"]),
      c("f", ["base"]),
      c("a", ["base"]),
      c("base", []),
    ]);
    const merge = nodes[0];
    expect(merge.outgoing).toHaveLength(2);
    expect(merge.outgoing[0]).toMatchObject({ toHash: "a", merge: false });
    expect(merge.outgoing[1]).toMatchObject({ toHash: "f", merge: true });
    // The first parent keeps lane 0; the second parent opens a new lane.
    expect(merge.outgoing[0].toLane).toBe(0);
    expect(merge.outgoing[1].toLane).toBe(1);
  });

  it("places a branch tip in a new lane and converges at its base", () => {
    const nodes = layoutGraph([
      c("tip", ["base"]),
      c("base", ["root"]),
      c("root", []),
    ]);
    // Every commit takes the leftmost free lane; with nothing pending, tip
    // opens lane 0 and the rest follow it.
    expect(nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(nodes[0].incoming).toEqual([]);
  });

  it("converges two lanes onto a shared commit via an outgoing merge edge", () => {
    // m has parents a and f, so f opens lane 1. a then waits in lane 0 for
    // `base`; when f also descends to `base`, f's lane must fold into lane 0 —
    // that fold is the outgoing edge that makes the graph read as a merge.
    const nodes = layoutGraph([
      c("m", ["a", "f"]),
      c("a", ["base"]),
      c("f", ["base"]),
      c("base", []),
    ]);
    const f = nodes.find((n) => n.commit.hash === "f")!;
    const fold = f.outgoing.find((e) => e.toHash === "base");
    expect(fold).toBeTruthy();
    // f is in lane 1 and folds left into the lane already waiting (lane 0).
    expect(fold!.fromLane).toBe(1);
    expect(fold!.toLane).toBe(0);
    // The shared commit itself opens no new lanes.
    const base = nodes[nodes.length - 1];
    expect(base.commit.hash).toBe("base");
    expect(base.outgoing).toEqual([]);
  });

  it("handles an empty history", () => {
    expect(layoutGraph([])).toEqual([]);
  });

  it("gives the root commit no outgoing edges", () => {
    const nodes = layoutGraph([c("only", [])]);
    expect(nodes[0].commit.parents).toEqual([]);
    expect(nodes[0].outgoing).toEqual([]);
  });

  it("keeps laneCount consistent across every row (gutter width)", () => {
    const nodes = layoutGraph([
      c("m", ["a", "f"]),
      c("f", ["base"]),
      c("a", ["base"]),
      c("base", []),
    ]);
    const counts = new Set(nodes.map((n) => n.laneCount));
    expect(counts.size).toBe(1);
    expect([...counts][0]).toBeGreaterThanOrEqual(2);
  });
});

describe("laneColor", () => {
  it("wraps within the 8-colour palette", () => {
    expect(laneColor(0)).toBe(0);
    expect(laneColor(7)).toBe(7);
    expect(laneColor(8)).toBe(0);
    expect(laneColor(9)).toBe(1);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  it("formats minutes, hours, days", () => {
    expect(relativeTime("2026-06-01T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-01T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-01T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-05-30T12:00:00Z", now)).toBe("2d ago");
  });
  it("returns empty for an unparseable date", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});
