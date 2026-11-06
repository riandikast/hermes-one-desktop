import type { WorkspaceSnapshot } from "../../../../shared/workspace-snapshot";
import { normalizePathKey } from "./fileChanges";
import type { FileChange } from "./types";

/** Git enumerates the scope; actual bytes distinguish pre-existing dirt from new edits. */
export function workspaceChanges(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[] {
  if (!before.root || !after.root || normalizePathKey(before.root) !== normalizePathKey(after.root)) return [];
  const excluded = [...(before.excludedPaths ?? []), ...(after.excludedPaths ?? [])].map(normalizePathKey);
  const oldFiles = new Map(before.files.map((file) => [normalizePathKey(file.path), file]));
  const newFiles = new Map(after.files.map((file) => [normalizePathKey(file.path), file]));
  const changes: FileChange[] = [];
  for (const key of new Set([...oldFiles.keys(), ...newFiles.keys()])) {
    if (excluded.some((path) => key === path || (key.startsWith(path) && key.charCodeAt(path.length) === 92))) continue; // Excluded directories cover their descendants too.
    const old = oldFiles.get(key);
    const next = newFiles.get(key);
    if (old?.fingerprint === next?.fingerprint) continue;
    changes.push({
      path: next?.path ?? old!.path,
      before: old?.content ?? null,
      after: next?.content ?? null,
      beforeKnown: !old || old.content !== null,
      afterKnown: !next || next.content !== null,
      source: "workspace",
    });
  }
  return changes;
}
