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
