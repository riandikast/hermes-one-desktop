import { useSyncExternalStore } from "react";

/**
 * How the sidebar's Projects section is ordered.
 *
 * - `name`        — A→Z by the project's DISPLAY name (alias when set, else the
 *                   folder's last segment), case-insensitively.
 * - `updated`     — most recently active project first. "Active" is the newest
 *                   session in the project: the group whose latest session is
 *                   newest wins, so a project moves to the top as soon as one of
 *                   its sessions is used.
 *
 * Frontend-only preference in localStorage, like project aliases — this is pure
 * sidebar chrome and survives app restarts because it never leaves localStorage.
 */
export type ProjectSort = "name" | "updated";

const SORT_KEY = "hermes.sidebar.projectSort";
/**
 * Remembered recency per project.
 *
 * The Projects section is built from the LOADED sessions — a paginated window
 * (30 at a time) of a globally recency-sorted list. So a project whose sessions
 * fall outside that window is represented by whichever one session happened to
 * be inside it, and its recency reads as "just now" even when its next-newest
 * session is far older. That made a project look like a one-session project
 * permanently pinned to the top.
 *
 * Recording the newest time we have ever SEEN for a project means the sort keeps
 * a truthful value once a project has been observed, instead of degrading to
 * "whatever is loaded right now".
 */
const RECENCY_KEY = "hermes.sidebar.projectRecency";

// Listeners fired on every change (local writes and cross-tab `storage`
// events). The snapshot is the sort value itself — a primitive string, which
// `useSyncExternalStore` compares by value — so no version counter is needed.
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

export function isProjectSort(value: unknown): value is ProjectSort {
  return value === "name" || value === "updated";
}

export function getProjectSort(): ProjectSort {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    return isProjectSort(raw) ? raw : "updated";
  } catch {
    return "updated";
  }
}

export function setProjectSort(sort: ProjectSort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    /* ignore persistence failures (quota / private mode) */
  }
  notify();
}

export function subscribeProjectSort(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Remembered project recency ────────────────────────────────────────────

function readRecency(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENCY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Fold the recency of the currently-loaded groups into the stored map.
 *
 * Only ever moves a timestamp FORWARD (max), so scrolling a project's older
 * sessions into view can never make it look less recent than it was.
 * Returns the merged map; writes only when something actually changed.
 */
export function rememberProjectRecency(
  groups: ReadonlyArray<{ path: string; latestAt: number }>,
): Record<string, number> {
  const stored = readRecency();
  let changed = false;
  for (const group of groups) {
    if (group.latestAt <= 0) continue;
    const previous = stored[group.path] ?? 0;
    if (group.latestAt > previous) {
      stored[group.path] = group.latestAt;
      changed = true;
    }
  }
  if (changed) {
    try {
      localStorage.setItem(RECENCY_KEY, JSON.stringify(stored));
    } catch {
      /* ignore persistence failures (quota / private mode) */
    }
  }
  return stored;
}

export function getProjectRecency(): Record<string, number> {
  return readRecency();
}

/**
 * Replace each group's `latestAt` with the newest value ever observed for it.
 *
 * This is the fix for "the project sorts by whatever one session is loaded":
 * a group's own `latestAt` is only as good as the current window, so the
 * remembered value wins whenever it is larger. A project never before seen
 * keeps its own value (and gets remembered on the next fold).
 */
export function applyRememberedRecency<
  T extends { path: string; latestAt: number },
>(groups: T[], remembered: Record<string, number>): T[] {
  return groups.map((group) => {
    const known = remembered[group.path];
    return known !== undefined && known > group.latestAt
      ? { ...group, latestAt: known }
      : group;
  });
}

export function getProjectSortSnapshot(): ProjectSort {
  return getProjectSort();
}

window.addEventListener("storage", (event) => {
  if (event.key === SORT_KEY) notify();
});

/** Subscribe the calling component to the sort preference. */
export function useProjectSort(): ProjectSort {
  return useSyncExternalStore(subscribeProjectSort, getProjectSortSnapshot);
}

/**
 * Order project groups for display.
 *
 * Both comparators fall back to the other key so equal entries keep a STABLE
 * order instead of shuffling between renders: two projects with the same name
 * break the tie by recency, and equal timestamps break by name.
 */
export function sortProjectGroups<
  T extends { path: string; name: string; latestAt: number },
>(groups: T[], sort: ProjectSort): T[] {
  const byName = (a: T, b: T): number => {
    const cmp = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    return cmp !== 0 ? cmp : b.latestAt - a.latestAt;
  };
  const byUpdated = (a: T, b: T): number => {
    const cmp = b.latestAt - a.latestAt;
    return cmp !== 0 ? cmp : byName(a, b);
  };
  return [...groups].sort(sort === "name" ? byName : byUpdated);
}
