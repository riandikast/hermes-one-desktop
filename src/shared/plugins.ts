/**
 * Agent-plugin rows for the Capabilities → Plugins tab.
 *
 * Mirrors the gateway's `plugins.manage list` result (`AgentPluginRow` in the
 * backend contract). The desktop keeps this a plain read model: the backend
 * owns discovery, catalog provenance and the update checks.
 */

export interface DashboardPluginServer {
  name: string;
  /** connected | app_not_running | missing_app | … */
  state: string;
  sentence: string;
}

export interface DashboardPlugin {
  name: string;
  key: string;
  version: string;
  description: string;
  /** bundled | user | git | catalog … */
  source: string;
  /** enabled | disabled | not enabled */
  status: string;
  portable: boolean;
  installDir: string;
  hasDesktopHalf: boolean;
  servers: DashboardPluginServer[];
  catalogName?: string;
  catalogTier?: string;
  updateAvailable: boolean;
  updateTarget?: string;
  pinnedSha?: string;
  tools: string[];
}

export interface DashboardPluginList {
  plugins: DashboardPlugin[];
  userCount: number;
  bundledCount: number;
}

/** Actions the desktop may ask for; install/inspect stay CLI/desktop-app owned. */
export const PLUGIN_ACTIONS = ["list", "toggle", "update", "update_all", "remove"] as const;
export type PluginAction = (typeof PLUGIN_ACTIONS)[number];

export interface PluginManageResult {
  ok?: boolean;
  error?: string;
  unchanged?: boolean;
  restartRequired?: boolean;
  name?: string;
  clearedMemoryProvider?: string;
  plugins?: DashboardPlugin[];
  userCount?: number;
  bundledCount?: number;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function mapPlugin(raw: Record<string, unknown>): DashboardPlugin {
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  return {
    name: text(raw.name),
    key: text(raw.key, text(raw.name)),
    version: text(raw.version),
    description: text(raw.description),
    source: text(raw.source, "bundled"),
    status: text(raw.status, "not enabled"),
    portable: raw.portable === true,
    installDir: text(raw.install_dir),
    hasDesktopHalf: raw.has_desktop_half === true,
    servers: servers.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        name: text(row.name),
        state: text(row.state, "unknown"),
        sentence: text(row.sentence),
      };
    }),
    catalogName: typeof raw.catalog_name === "string" ? raw.catalog_name : undefined,
    catalogTier: typeof raw.catalog_tier === "string" ? raw.catalog_tier : undefined,
    updateAvailable: raw.update_available === true,
    updateTarget: typeof raw.update_target === "string" ? raw.update_target : undefined,
    pinnedSha: typeof raw.pinned_sha === "string" ? raw.pinned_sha : undefined,
    tools: Array.isArray(raw.tools) ? raw.tools.map((tool) => String(tool)) : [],
  };
}

export function parseDashboardPlugins(raw: unknown): DashboardPluginList {
  const record = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.plugins) ? record.plugins : [];
  const plugins = rows.map((row) => mapPlugin((row ?? {}) as Record<string, unknown>));
  return {
    plugins,
    userCount: typeof record.user_count === "number"
      ? record.user_count
      : plugins.filter((plugin) => plugin.source !== "bundled").length,
    bundledCount: typeof record.bundled_count === "number"
      ? record.bundled_count
      : plugins.filter((plugin) => plugin.source === "bundled").length,
  };
}

export function parsePluginManageResult(raw: unknown): PluginManageResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const list = parseDashboardPlugins(raw);
  return {
    ok: typeof record.ok === "boolean" ? record.ok : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    unchanged: record.unchanged === true,
    restartRequired: record.restart_required === true,
    name: typeof record.name === "string" ? record.name : undefined,
    clearedMemoryProvider:
      typeof record.cleared_memory_provider === "string" ? record.cleared_memory_provider : undefined,
    // A toggle/update answer carries no rows; keep the list undefined then so the
    // caller knows to refetch instead of rendering an empty table.
    plugins: Array.isArray(record.plugins) ? list.plugins : undefined,
    userCount: typeof record.user_count === "number" ? record.user_count : undefined,
    bundledCount: typeof record.bundled_count === "number" ? record.bundled_count : undefined,
  };
}

export function isPluginEnabled(plugin: DashboardPlugin): boolean {
  return plugin.status === "enabled";
}

/** A user install may be removed; bundled plugins ship with the backend. */
export function canRemovePlugin(plugin: DashboardPlugin): boolean {
  return plugin.source !== "bundled";
}

/** Short display target for an available update. */
export function pluginUpdateLabel(plugin: DashboardPlugin): string {
  if (plugin.updateTarget) {
    return /^[0-9a-f]{40}$/i.test(plugin.updateTarget)
      ? plugin.updateTarget.slice(0, 8)
      : plugin.updateTarget;
  }
  return plugin.catalogTier ? `catalog ${plugin.catalogTier}` : "";
}
