import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "../../../../shared/workspace-snapshot";
import { workspaceChanges } from "./workspaceChanges";
import { mergePromptFileChanges } from "./fileChangeSummary";

const snapshot = (contents: Record<string, string | null>): WorkspaceSnapshot => ({
  root: "C:/repo", files: Object.entries(contents).map(([path, content]) => ({
    path: `C:/repo/${path}`, fingerprint: content ?? "binary", content,
  })),
});

it("compares bytes, not dirty status; includes staged/untracked/deleted paths but excludes unchanged dirt", () => {
  const changes = workspaceChanges(snapshot({ dirty: "already dirty", untouched: "dirty too", deleted: "old" }),
    snapshot({ dirty: "edited again", untouched: "dirty too", staged: "new", "nested/untracked": "new" }));
  expect(changes.map((change) => change.path)).toEqual([
    "C:/repo/dirty", "C:/repo/deleted", "C:/repo/staged", "C:/repo/nested/untracked",
  ]);
  expect(changes).toContainEqual({ path: "C:/repo/deleted", before: "old", after: null, beforeKnown: true, afterKnown: true, source: "workspace" });
  expect(changes.find((change) => change.path.endsWith("dirty"))).toMatchObject({ before: "already dirty", after: "edited again" });
});

it("fails closed on failed/different roots and exclusions in either snapshot", () => {
  const before = snapshot({ a: "old", b: "old" });
  const after = snapshot({ a: "new" });
  expect(workspaceChanges(before, { ...after, root: null })).toEqual([]);
  expect(workspaceChanges(before, { ...after, root: "C:/other" })).toEqual([]);
  expect(workspaceChanges({ ...before, excludedPaths: ["C:/repo/a"] }, { ...after, excludedPaths: ["C:/repo/b"] })).toEqual([]);
  expect(workspaceChanges(snapshot({ "generated/a": "old" }), { ...snapshot({}), excludedPaths: ["C:/repo/generated"] })).toEqual([]);
});

it("keeps binary changes without presenting unavailable content as creation/deletion", () => {
  const before = snapshot({ binary: null });
  const after = snapshot({ binary: null });
  after.files[0].fingerprint = "new binary bytes";
  expect(workspaceChanges(before, after)).toEqual([
    { path: "C:/repo/binary", before: null, after: null, beforeKnown: false, afterKnown: false, source: "workspace" },
  ]);
});

it("deduplicates direct edits with workspace evidence, retaining confirmed attribution", () => {
  const fallback = workspaceChanges(snapshot({ a: "old" }), snapshot({ a: "after" }));
  const direct = { path: "C:/repo/a", before: "old", after: "after", beforeKnown: true };
  expect(mergePromptFileChanges(fallback, [direct])).toEqual([expect.objectContaining({ path: direct.path, source: undefined })]);
  expect(mergePromptFileChanges([direct], fallback)).toEqual([expect.objectContaining({ path: direct.path, source: undefined })]);
});
