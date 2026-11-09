/**
 * Frontend-only FALLBACK model chain for the chat ModelPicker.
 *
 * When the active model fails (provider 5xx, model unavailable, an auth
 * rejection that is provider-attributable rather than user-caused), the chat
 * can hand the turn to the next model in this ordered list instead of giving
 * up. This exists purely in the renderer — localStorage plus a small pub/sub —
 * so no backend or provider configuration is involved.
 *
 * Entries are stored by STABLE row key (`modelKeyOf`: provider::baseUrl::model)
 * plus the display label, so the list survives a model being renamed or
 * reordered on the Providers page. `order` is the array order: index 0 is tried
 * first after the primary model.
 */

import { modelKeyOf } from "./modelGroups";

export interface FallbackModel {
  /** Stable identity: `${provider}::${baseUrl}::${model}`. */
  key: string;
  provider: string;
  model: string;
  baseUrl: string;
  /** Display label captured at add time (a rename elsewhere won't retitle). */
  label: string;
  /**
   * Routing keys this UI does not edit (`key_env`, `api_mode`, …) carried over
   * from config.yaml. They ride along on publish so a picker edit cannot strip
   * a hand-written local-gateway chain down to bare provider/model pairs.
   */
  extra?: Record<string, string>;
}

const STORAGE_KEY = "hermes.chat.fallbackModels.v1";
const CHANGE_EVENT = "fallback-models:changed";

/** Build a fallback entry from picker row fields. */
export function fallbackFromRow(row: {
  provider: string;
  model: string;
  baseUrl: string;
  label: string;
}): FallbackModel {
  return {
    key: modelKeyOf(row.provider, row.baseUrl, row.model),
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl || "",
    label: row.label,
  };
}

/** Read the chain. Unknown/legacy shapes are dropped rather than crashing. */
export function loadFallbackModels(): FallbackModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { models?: FallbackModel[] };
    if (!Array.isArray(parsed.models)) return [];
    return parsed.models.filter(
      (m) =>
        m &&
        typeof m.key === "string" &&
        typeof m.provider === "string" &&
        typeof m.model === "string" &&
        typeof m.baseUrl === "string",
    );
  } catch {
    return [];
  }
}

function writeLocal(models: FallbackModel[]): void {
  try {
    if (models.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ models }));
    }
  } catch {
    // Storage full / disabled — the chain is a convenience, never fatal.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Persist the chain.
 *
 * `config.yaml` `fallback_providers` is the authoritative chain the agent
 * reads (the official desktop edits that same list), so every edit publishes
 * there immediately instead of waiting for the next failed turn. localStorage
 * stays a synchronous cache for the picker UI.
 */
export function saveFallbackModels(models: FallbackModel[]): void {
  writeLocal(models);
  void publishFallbackChainToConfig(models);
}

/**
 * Adopt the chain stored in `config.yaml`.
 *
 * The picker used to be the only writer, so a chain configured elsewhere (the
 * Providers page editor, the CLI, the official desktop) was invisible here and
 * a stale local list could still win a failed turn. Config wins once it has
 * entries; an empty config with a non-empty local list is migrated up instead
 * of being wiped.
 */
export async function refreshFallbackModelsFromConfig(
  profile?: string | null,
): Promise<FallbackModel[]> {
  const local = loadFallbackModels();
  try {
    const getChain = window.hermesAPI?.getFallbackProviders;
    if (typeof getChain !== "function") return local;
    const entries = await getChain(profile ?? undefined);
    if (!Array.isArray(entries)) return local;
    const configured = entries
      .filter((entry) => entry.provider && entry.model)
      .map((entry) => {
        const { provider, model, base_url: baseUrl = "", ...extra } = entry;
        return {
          key: modelKeyOf(provider, baseUrl, model),
          provider,
          model,
          baseUrl,
          label: `${provider} / ${model}`,
          ...(Object.keys(extra).length > 0 ? { extra } : {}),
        };
      });
    if (configured.length === 0) {
      if (local.length > 0) void publishFallbackChainToConfig(local, profile);
      return local;
    }
    if (JSON.stringify(configured) !== JSON.stringify(local)) writeLocal(configured);
    return configured;
  } catch {
    return local;
  }
}

/** Sync other picker instances and other windows of the same app. */
export function subscribeFallbackModels(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const CONFIG_CHANGED_EVENT = "fallback-models:config-changed";

/**
 * Announce that `fallback_providers` changed outside the picker (the Providers
 * page editor, a reset, a profile switch). The picker answers by re-reading
 * config, so an open dialog never shows a chain the file no longer has.
 */
export function notifyFallbackConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT));
}

export function subscribeFallbackConfigChanged(cb: () => void): () => void {
  window.addEventListener(CONFIG_CHANGED_EVENT, cb);
  return () => window.removeEventListener(CONFIG_CHANGED_EVENT, cb);
}

/**
 * Append a model to the end of the chain. Idempotent: a model already present
 * keeps its position (adding it again must not duplicate or reorder the chain).
 */
export function addFallbackModel(
  models: FallbackModel[],
  entry: FallbackModel,
): FallbackModel[] {
  if (models.some((m) => m.key === entry.key)) return models;
  return [...models, entry];
}

export function removeFallbackModel(
  models: FallbackModel[],
  key: string,
): FallbackModel[] {
  return models.filter((m) => m.key !== key);
}

/**
 * Move an entry by one slot. Returns the SAME array when the move is a no-op
 * (already at the end / unknown key), so callers can skip a needless save.
 */
export function moveFallbackModel(
  models: FallbackModel[],
  key: string,
  direction: -1 | 1,
): FallbackModel[] {
  const index = models.findIndex((m) => m.key === key);
  if (index < 0) return models;
  const target = index + direction;
  if (target < 0 || target >= models.length) return models;
  const next = [...models];
  const [entry] = next.splice(index, 1);
  next.splice(target, 0, entry!);
  return next;
}

/**
 * The chain to try, in order, with the PRIMARY model removed.
 *
 * If the user's active model is also in the fallback list, trying it first is a
 * pointless retry of the thing that just failed — skip it.
 */
export function fallbackChainFor(
  models: FallbackModel[],
  primaryKey: string | null,
): FallbackModel[] {
  if (!primaryKey) return models;
  return models.filter((m) => m.key !== primaryKey);
}

/** Stable key for the active model, matching picker row identity. */
export function primaryKeyOf(
  provider: string,
  baseUrl: string,
  model: string,
): string | null {
  if (!provider || !model) return null;
  return modelKeyOf(provider, baseUrl, model);
}

/**
 * Mirror the picker's chain into `config.yaml` `fallback_providers`.
 *
 * The picker (this module, localStorage) and the backend chain were
 * INDEPENDENT: the dialog edited one list while the gateway read another, so a
 * failed turn could fail over to a model the user never listed — or not at all
 * — with no way to see which from the UI. This makes the picker authoritative
 * by publishing its list where the backend actually reads it.
 *
 * Only the fields the backend understands are sent: `provider` and `model`,
 * plus `base_url` / `key_env` when the row carries them (a local-gateway chain
 * must not be rewritten into bare provider/model pairs and re-routed to a
 * public endpoint — the #89184 class of bug).
 *
 * Resolves to true when the write landed. Never throws: a failed publish must
 * not break a send, and the renderer chain still recovers the turn on its own.
 */
export async function publishFallbackChainToConfig(
  models: FallbackModel[],
  profile?: string | null,
): Promise<boolean> {
  try {
    const setConfig = window.hermesAPI?.setConfig;
    if (typeof setConfig !== "function") return false;

    const entries = models
      .filter((m) => m.provider && m.model)
      .map((m) => {
        // Preserved routing keys first, then the edited pair, so an unedited
        // `key_env` / `api_mode` survives and the edited fields always win.
        const entry: Record<string, string> = { ...(m.extra ?? {}) };
        entry.provider = m.provider;
        entry.model = m.model;
        if (m.baseUrl) entry.base_url = m.baseUrl;
        else delete entry.base_url;
        return entry;
      });

    // An empty chain is a real instruction: clear the key so a stale backend
    // chain from an earlier session cannot outlive the picker's list.
    await setConfig("fallback_providers", JSON.stringify(entries), profile ?? undefined);
    return true;
  } catch {
    return false;
  }
}
