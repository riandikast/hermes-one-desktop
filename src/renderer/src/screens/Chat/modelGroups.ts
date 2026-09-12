/**
 * Frontend-only custom model groups for the chat ModelPicker.
 *
 * Users group models however they like (by task, by project, across
 * providers) WITHOUT touching provider configuration — this exists purely in
 * the renderer: localStorage + a small pub/sub. Selection routing is
 * unaffected: every model row keeps its own provider/model/baseUrl, so a
 * group is only a different way to *find* a row, never a different way to
 * *route* it.
 */

export interface CustomModelGroup {
  id: string;
  name: string;
  /** Stable row keys: `${provider}::${baseUrl}::${model}` */
  modelKeys: string[];
}

const STORAGE_KEY = "hermes.chat.modelGroups.v1";
const CHANGE_EVENT = "model-groups:changed";

/** Stable identity for a picker row. Display-name renames don't change it. */
export function modelKeyOf(
  provider: string,
  baseUrl: string,
  model: string,
): string {
  return [provider, (baseUrl || "").trim(), model].join("::");
}

export function loadModelGroups(): CustomModelGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { groups?: CustomModelGroup[] };
    if (!Array.isArray(parsed.groups)) return [];
    return parsed.groups.filter(
      (g) =>
        g &&
        typeof g.id === "string" &&
        typeof g.name === "string" &&
        Array.isArray(g.modelKeys) &&
        g.modelKeys.every((k) => typeof k === "string"),
    );
  } catch {
    return [];
  }
}

export function saveModelGroups(groups: CustomModelGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups }));
  } catch {
    // Storage full / disabled — grouping is cosmetic, never fatal.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Sync other picker instances and other windows of the same app. */
export function subscribeModelGroups(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function newGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
