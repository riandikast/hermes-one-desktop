// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyRememberedRecency,
  getProjectSort,
  rememberProjectRecency,
  setProjectSort,
  sortProjectGroups,
} from "./projectSort";
// The web tsconfig deliberately excludes node types, so importing node:fs
// directly fails typecheck. chatWiring.test.ts uses the same escape hatch; read
// the sidebar source for the WIRING assertions below.
// @ts-expect-error -- node types are intentionally outside the web tsconfig
const nodeModule = (await import("node:module")) as unknown as {
  createRequire: (url: string) => (id: string) => {
    readFileSync: (path: string, encoding: string) => string;
  };
};

/**
 * Projects-section ordering. Two things matter: "last updated" must order by the
 * NEWEST session in each project (so a project rises when any of its sessions is
 * used), and the order must be STABLE — equal keys must not shuffle between
 * renders.
 */

const group = (
  path: string,
  name: string,
  latestAt: number,
): { path: string; name: string; latestAt: number } => ({
  path,
  name,
  latestAt,
});

beforeEach(() => {
  localStorage.clear();
});

describe("sortProjectGroups", () => {
  it("sorts by name, case-insensitively", () => {
    const groups = [
      group("c", "zeta", 10),
      group("a", "Alpha", 20),
      group("b", "beta", 30),
    ];
    expect(sortProjectGroups(groups, "name").map((g) => g.name)).toEqual([
      "Alpha",
      "beta",
      "zeta",
    ]);
  });

  it("sorts by name with numeric awareness (v2 before v10)", () => {
    const groups = [group("a", "proj v10", 1), group("b", "proj v2", 1)];
    expect(sortProjectGroups(groups, "name").map((g) => g.name)).toEqual([
      "proj v2",
      "proj v10",
    ]);
  });

  it("sorts by last update, newest project first", () => {
    const groups = [
      group("a", "alpha", 100),
      group("b", "beta", 300),
      group("c", "gamma", 200),
    ];
    expect(sortProjectGroups(groups, "updated").map((g) => g.name)).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
  });

  it("a project rises when ANY of its sessions is newest", () => {
    // "old" holds the globally newest session, so it must lead — even though its
    // other session is the oldest of all. This is the "one of the session is the
    // latest among other project" rule.
    const groups = [
      group("new", "new", 900),
      group("old", "old", 5000),
    ];
    expect(sortProjectGroups(groups, "updated").map((g) => g.name)).toEqual([
      "old",
      "new",
    ]);
  });

  it("breaks ties by name so the order is stable", () => {
    // Equal timestamps (e.g. a batch of sessions sharing one start time) must
    // not shuffle between renders.
    const groups = [
      group("c", "gamma", 42),
      group("a", "alpha", 42),
      group("b", "beta", 42),
    ];
    expect(sortProjectGroups(groups, "updated").map((g) => g.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    // Same input, same output — and the input array is not mutated.
    expect(sortProjectGroups(groups, "updated").map((g) => g.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(groups.map((g) => g.name)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("breaks name ties by recency", () => {
    const groups = [
      group("a", "same", 10),
      group("b", "same", 99),
    ];
    expect(sortProjectGroups(groups, "name").map((g) => g.latestAt)).toEqual([
      99, 10,
    ]);
  });

  it("treats a project with no timestamp as oldest", () => {
    const groups = [group("a", "alpha", 0), group("b", "beta", 5)];
    expect(sortProjectGroups(groups, "updated").map((g) => g.name)).toEqual([
      "beta",
      "alpha",
    ]);
  });
});

describe("project sort persistence", () => {
  it("defaults to last-updated", () => {
    expect(getProjectSort()).toBe("updated");
  });

  it("round-trips a choice through localStorage", () => {
    setProjectSort("name");
    expect(getProjectSort()).toBe("name");
    expect(localStorage.getItem("hermes.sidebar.projectSort")).toBe("name");
  });

  it("ignores a corrupt stored value and falls back", () => {
    localStorage.setItem("hermes.sidebar.projectSort", "bogus");
    expect(getProjectSort()).toBe("updated");
  });

  it("survives a remount (value is read from storage, not memory)", () => {
    setProjectSort("name");
    // A fresh read models the next app launch.
    expect(getProjectSort()).toBe("name");
  });
});

describe("remembered project recency", () => {
  it("records the newest time seen per project", () => {
    const map = rememberProjectRecency([
      { path: "C:/a", latestAt: 100 },
      { path: "C:/b", latestAt: 300 },
    ]);
    expect(map).toEqual({ "C:/a": 100, "C:/b": 300 });
  });

  it("only ever moves a project's time FORWARD", () => {
    rememberProjectRecency([{ path: "C:/a", latestAt: 500 }]);
    // A later fold that only sees an OLDER session (scrolled past the newest)
    // must not make the project look less recent.
    const map = rememberProjectRecency([{ path: "C:/a", latestAt: 200 }]);
    expect(map["C:/a"]).toBe(500);
  });

  it("ignores a zero/absent timestamp", () => {
    const map = rememberProjectRecency([{ path: "C:/a", latestAt: 0 }]);
    expect(map["C:/a"]).toBeUndefined();
  });

  it("keeps projects not present in the current window", () => {
    rememberProjectRecency([{ path: "C:/gone", latestAt: 900 }]);
    const map = rememberProjectRecency([{ path: "C:/here", latestAt: 100 }]);
    // The project loaded earlier is still remembered even though the current
    // window does not include it — that is the whole point.
    expect(map["C:/gone"]).toBe(900);
    expect(map["C:/here"]).toBe(100);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("hermes.sidebar.projectRecency", "{not json");
    const map = rememberProjectRecency([{ path: "C:/a", latestAt: 5 }]);
    expect(map["C:/a"]).toBe(5);
  });

  it("discards a legacy MILLISECOND entry so it cannot pin a project", () => {
    // An older build stored ms (~1e12). Left in place it would outrank every
    // real project forever, which is exactly the "stuck at the top" symptom.
    localStorage.setItem(
      "hermes.sidebar.projectRecency",
      JSON.stringify({ "C:/mb": 1_760_000_000_000 }),
    );
    const map = rememberProjectRecency([{ path: "C:/other", latestAt: 1_760_000_000 }]);
    expect(map["C:/mb"]).toBeUndefined();
    expect(map["C:/other"]).toBe(1_760_000_000);
  });
});

describe("applyRememberedRecency", () => {
  it("keeps the group's own recency when it is the larger value", () => {
    // A project just used reads NEWER than anything remembered, and that must
    // win — otherwise a freshly-used project would sink.
    const groups = [{ path: "C:/mb", name: "Mb", latestAt: 9_000 }];
    const out = applyRememberedRecency(groups, { "C:/mb": 1_000 });
    expect(out[0]!.latestAt).toBe(9_000);
  });

  it("uses the remembered value for a project that scrolled out of the window", () => {
    const groups = [{ path: "C:/mb", name: "Mb", latestAt: 1_000 }];
    const out = applyRememberedRecency(groups, { "C:/mb": 5_000 });
    expect(out[0]!.latestAt).toBe(5_000);
  });

  it("leaves a never-seen project untouched", () => {
    const groups = [{ path: "C:/new", name: "new", latestAt: 42 }];
    expect(applyRememberedRecency(groups, {})[0]!.latestAt).toBe(42);
  });

  it("does not mutate the input groups", () => {
    const groups = [{ path: "C:/mb", name: "Mb", latestAt: 1_000 }];
    applyRememberedRecency(groups, { "C:/mb": 5_000 });
    expect(groups[0]!.latestAt).toBe(1_000);
  });

  it("fixes the reported ordering once folded through the sorter", () => {
    // THE reported bug: "Mb" sat permanently on top because its one LOADED
    // session looked newest. With last-activity recency, its real (older)
    // activity is what counts, so it sorts below a genuinely recent project.
    const groups = [
      { path: "C:/mb", name: "Mb", latestAt: 9_000 }, // looks newest now
      { path: "C:/other", name: "Other", latestAt: 8_000 },
    ];
    const remembered = { "C:/mb": 1_000, "C:/other": 8_000 };
    const sorted = sortProjectGroups(
      applyRememberedRecency(groups, remembered),
      "updated",
    );
    // Mb's own 9000 is larger, so it still wins here — which is why the REAL
    // fix is last-activity recency (the group's latestAt must be truthful),
    // not remembering. The remembered value is the scroll-stability guard for
    // projects whose sessions leave the loaded window.
    expect(sorted.map((g) => g.name)).toEqual(["Mb", "Other"]);
  });

  it("a stale group recency no longer hides the true last activity", () => {
    // With last-activity recency the group already carries a TRUTHFUL value, so
    // the remembered map only ever helps by preserving it across loads.
    const groups = [
      { path: "C:/mb", name: "Mb", latestAt: 1_000 },
      { path: "C:/other", name: "Other", latestAt: 8_000 },
    ];
    const sorted = sortProjectGroups(
      applyRememberedRecency(groups, { "C:/mb": 1_000, "C:/other": 8_000 }),
      "updated",
    );
    expect(sorted.map((g) => g.name)).toEqual(["Other", "Mb"]);
  });
});

describe("SidebarRecentSessions wiring", () => {
  // Read the component source: these are WIRING facts (does the UI actually
  // call the sorter, is the timestamp carried through) that a pure-logic test
  // cannot see.
  const source = nodeModule
    .createRequire(import.meta.url)("node:fs")
    .readFileSync(
      "src/renderer/src/screens/Layout/SidebarRecentSessions.tsx",
      "utf8",
    );

  it("carries session recency through the normalizer", () => {
    // Without the timestamps surviving normalizeRows, the sort could only ever
    // see zeros and would silently do nothing.
    expect(source).toContain("startedAt?: number");
    expect(source).toMatch(/startedAt:\s*typeof startedAt === "number"/);
    expect(source).toContain("lastActiveAt?: number");
    expect(source).toMatch(/lastActiveAt:\s*\r?\n?\s*typeof lastActiveAt === "number"/);
  });

  it("prefers LAST ACTIVITY over start time for project recency", () => {
    // startedAt is when a session was OPENED; lastActiveAt is when it was last
    // USED. Ordering by start is what made "last updated" wrong.
    expect(source).toContain("s.lastActiveAt ?? s.startedAt ?? 0");
  });

  it("derives each project's recency from its NEWEST session", () => {
    // The max (not list[0]) so the order does not depend on the array arriving
    // pre-sorted.
    expect(source).toMatch(/latestAt:\s*list\.reduce/);
  });

  it("sorts the groups it actually renders, using remembered recency", () => {
    expect(source).toContain("sortProjectGroups(");
    expect(source).toContain("applyRememberedRecency(");
    expect(source).toContain("rememberProjectRecency(");
    // filteredGroups feeds the render. When there is no search it must BE the
    // sorted array — not the raw projectGroups, which would silently undo the
    // preference.
    const idx = source.indexOf("const filteredGroups");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain("sortedProjectGroups");
    expect(block).not.toMatch(/:\s*projectGroups,/);
  });

  it("exposes the sort menu on right-click of the Projects heading", () => {
    // Anchor on the Projects section heading itself: it renders the projects
    // label, and the toggle directly above it carries the right-click handler.
    const labelIdx = source.indexOf('{t("navigation.projects")}');
    expect(labelIdx).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, labelIdx - 700), labelIdx);
    expect(before).toContain("sidebar-recent-section-toggle");
    expect(before).toContain("onContextMenu");
    expect(before).toContain("setProjectsSectionMenu");
    // And choosing an option persists it.
    expect(source).toContain("setProjectSort(value");
  });

  it("detects a changed timestamp so re-orders actually reach the UI", () => {
    // sameSessions short-circuits state updates; if startedAt were excluded, a
    // session that only bumped its time would never re-sort the list.
    const sameIdx = source.indexOf("function sameSessions");
    const block = source.slice(sameIdx, sameIdx + 700);
    expect(block).toContain("startedAt");
  });

  it("defers a background refresh while the user is scrolling", () => {
    // The apply REPLACES and re-sorts the list, so landing it mid-scroll moves
    // rows under the user's finger (the intermittent stuck up/down stutter).
    // Guarded in source because the bug needs a refresh to land during a
    // gesture, which a unit test cannot reliably stage.
    const refreshIdx = source.indexOf("const refresh = useCallback(");
    expect(refreshIdx).toBeGreaterThan(-1);
    // Bound the body strictly: up to the point it first touches the apply, so a
    // later check cannot satisfy these assertions.
    const body = source.slice(refreshIdx, refreshIdx + 1600);
    expect(body).toContain("canApplyRefreshNow");
    expect(body).toContain("deferredRefreshRef.current = () => void refresh(force)");

    // The FIRST thing refresh does must be the gate — before it even calls
    // syncSessionCache. A check placed only AFTER the await would still let the
    // list change under a finger mid-scroll.
    const gateIdx = body.indexOf("canApplyRefreshNow");
    const syncIdx = body.indexOf("syncSessionCache()");
    expect(syncIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(syncIdx);

    // Deferred, not dropped: the pending refresh is re-run once scrolling stops.
    expect(source).toContain("const deferred = deferredRefreshRef.current");
    expect(source).toContain("deferred?.()");
    // And the scroll handler records the activity that arms the gate.
    expect(source).toContain("onScrollActivity()");
  });
});
