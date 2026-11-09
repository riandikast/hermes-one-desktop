import { getConfigObjectList, getConnectionConfig } from "./config";
import { ensureDashboardConnection } from "./dashboard-capabilities";
import { dashboardRequestJson } from "./dashboard";
import { remoteDashboardRequestJson } from "./remote-api";

/**
 * Model settings that only the dashboard backend can serve: the Mixture of
 * Agents preset document (`/api/model/moa`) and the raw config record needed
 * to read the fallback chain on a remote/SSH target.
 *
 * Both mirror the official desktop's client calls, so a profile edited here is
 * the same document the agent and `hermes` CLI read.
 */
export interface MoaModelSlot {
  provider: string;
  model: string;
  reasoning_effort?: string | null;
  enabled?: boolean;
}

export interface MoaPreset {
  reference_models: MoaModelSlot[];
  aggregator: MoaModelSlot;
  reference_temperature: number | null;
  aggregator_temperature: number | null;
  reference_timeout: number | null;
  degraded_reference_policy: "loud" | "silent";
  fanout?: string | null;
  enabled: boolean;
}

export interface MoaConfig {
  default_preset: string;
  active_preset: string;
  presets: Record<string, MoaPreset>;
}

export type FallbackEntry = Record<string, string>;

function connectionMode(): "local" | "remote" | "ssh" {
  return getConnectionConfig().mode;
}

function asMoaConfig(raw: unknown): MoaConfig {
  const record = (raw ?? {}) as Record<string, unknown>;
  const presets = (record.presets ?? {}) as Record<string, unknown>;
  const normalized: Record<string, MoaPreset> = {};
  for (const [name, value] of Object.entries(presets)) {
    const preset = (value ?? {}) as Record<string, unknown>;
    const slot = (input: unknown): MoaModelSlot => {
      const row = (input ?? {}) as Record<string, unknown>;
      return {
        provider: typeof row.provider === "string" ? row.provider : "",
        model: typeof row.model === "string" ? row.model : "",
        reasoning_effort: typeof row.reasoning_effort === "string" ? row.reasoning_effort : null,
        enabled: row.enabled !== false,
      };
    };
    normalized[name] = {
      reference_models: Array.isArray(preset.reference_models)
        ? preset.reference_models.map(slot)
        : [],
      aggregator: slot(preset.aggregator),
      reference_temperature:
        typeof preset.reference_temperature === "number" ? preset.reference_temperature : null,
      aggregator_temperature:
        typeof preset.aggregator_temperature === "number" ? preset.aggregator_temperature : null,
      reference_timeout:
        typeof preset.reference_timeout === "number" ? preset.reference_timeout : null,
      degraded_reference_policy:
        preset.degraded_reference_policy === "silent" ? "silent" : "loud",
      fanout: typeof preset.fanout === "string" ? preset.fanout : null,
      enabled: preset.enabled !== false,
    };
  }
  return {
    default_preset: typeof record.default_preset === "string" ? record.default_preset : "default",
    active_preset: typeof record.active_preset === "string" ? record.active_preset : "",
    presets: normalized,
  };
}

export async function getMoaConfig(profile?: string): Promise<MoaConfig> {
  if (connectionMode() === "remote") {
    const raw = await remoteDashboardRequestJson<unknown>(
      getConnectionConfig(),
      "/api/model/moa",
      { timeoutMs: 30_000 },
      profile,
    );
    return asMoaConfig(raw);
  }
  const conn = await ensureDashboardConnection(profile);
  const raw = await dashboardRequestJson<unknown>(conn.baseUrl, conn.token, "/api/model/moa", {
    timeoutMs: 30_000,
  });
  return asMoaConfig(raw);
}

export async function saveMoaConfig(config: MoaConfig, profile?: string): Promise<MoaConfig> {
  if (connectionMode() === "remote") {
    const raw = await remoteDashboardRequestJson<unknown>(
      getConnectionConfig(),
      "/api/model/moa",
      { method: "PUT", body: config, timeoutMs: 60_000 },
      profile,
    );
    return asMoaConfig(raw);
  }
  const conn = await ensureDashboardConnection(profile);
  const raw = await dashboardRequestJson<unknown>(conn.baseUrl, conn.token, "/api/model/moa", {
    method: "PUT",
    body: config,
    timeoutMs: 60_000,
  });
  return asMoaConfig(raw);
}

/**
 * The ordered `fallback_providers` chain. Local reads come straight from
 * config.yaml (the same file the agent reads); remote/SSH reads go through the
 * dashboard's config record so the editor never shows this machine's chain for
 * a remote profile.
 */
export async function getFallbackProviders(profile?: string): Promise<FallbackEntry[]> {
  if (connectionMode() === "local") {
    return getConfigObjectList("fallback_providers", profile);
  }
  const raw = connectionMode() === "remote"
    ? await remoteDashboardRequestJson<unknown>(
        getConnectionConfig(),
        "/api/config?include_defaults=false",
        { timeoutMs: 30_000 },
        profile,
      )
    : await (async () => {
        const conn = await ensureDashboardConnection(profile);
        return dashboardRequestJson<unknown>(
          conn.baseUrl,
          conn.token,
          "/api/config?include_defaults=false",
          { timeoutMs: 30_000 },
        );
      })();
  const record = (raw ?? {}) as Record<string, unknown>;
  const chain = Array.isArray(record.fallback_providers) ? record.fallback_providers : [];
  return chain
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) =>
      Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [key, value == null ? "" : String(value)]),
      ),
    );
}
