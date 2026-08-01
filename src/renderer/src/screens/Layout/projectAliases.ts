import { useSyncExternalStore } from "react";

// Frontend-only project aliases: a display name for a folder path, stored in
// localStorage. Nothing on disk or in session records is touched — this is
// pure sidebar chrome (keyed by the normalized folder path).
const ALIASES_KEY = "hermes.sidebar.projectAliases";

// Version bumped on every alias change (local writes and cross-tab `storage`
// events) so `useSyncExternalStore` subscribers re-render.
let version = 0;
const listeners = new Set<() => void>();

export function normalizeProjectPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, "/");
  normalized = normalized.replace(/\/+$/, "");
  if (/^[a-zA-Z]:/.test(normalized)) {
    // Fold only the Windows drive letter — the rest of the path stays as-is.
    normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

function readAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALIASES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function notify(): void {
  version += 1;
  for (const listener of Array.from(listeners)) listener();
}

export function getProjectAlias(path: string): string | null {
  const name = readAliases()[normalizeProjectPath(path)];
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

export function setProjectAlias(path: string, name: string): void {
  const key = normalizeProjectPath(path);
  const trimmed = name.trim();
  const aliases = readAliases();
  if (trimmed) aliases[key] = trimmed;
  else delete aliases[key];
  try {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
  } catch {
    /* ignore persistence failures (quota / private mode) */
  }
  notify();
}

export function projectDisplayName(path: string): string {
  const alias = getProjectAlias(path);
  if (alias) return alias;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

export function subscribeProjectAliases(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

window.addEventListener("storage", (event) => {
  if (event.key === ALIASES_KEY) notify();
});

export function getProjectAliasesSnapshot(): string {
  return String(version);
}

/** Subscribe the calling component to alias changes; the returned snapshot
 *  string changes whenever any alias is written or removed. */
export function useProjectAliases(): string {
  return useSyncExternalStore(
    subscribeProjectAliases,
    getProjectAliasesSnapshot,
  );
}
