import {
  PLUGIN_ACTIONS,
  parseDashboardPlugins,
  parsePluginManageResult,
  type DashboardPluginList,
  type PluginAction,
  type PluginManageResult,
} from "../shared/plugins";
import { dashboardRpc } from "./dashboard-rpc";

/**
 * Agent plugins over the gateway's `plugins.manage` RPC.
 *
 * Writes are restricted to the actions Hermes One renders; install/inspect
 * flows (catalog browser, desktop halves) stay in the official desktop and the
 * `hermes plugins` CLI.
 */
function assertAction(action: unknown): PluginAction {
  if (typeof action === "string" && (PLUGIN_ACTIONS as readonly string[]).includes(action)) {
    return action as PluginAction;
  }
  throw new Error(`Unsupported plugin action: ${String(action)}`);
}

export async function listDashboardPlugins(profile?: string): Promise<DashboardPluginList> {
  const raw = await dashboardRpc<unknown>("plugins.manage", { action: "list" }, profile);
  return parseDashboardPlugins(raw);
}

export async function manageDashboardPlugin(
  action: string,
  fields: Record<string, unknown>,
  profile?: string,
): Promise<PluginManageResult> {
  const valid = assertAction(action);
  const raw = await dashboardRpc<unknown>(
    "plugins.manage",
    { action: valid, ...fields },
    profile,
    valid === "update_all" ? 120_000 : 60_000,
  );
  const result = parsePluginManageResult(raw);
  if (result.ok === false) {
    throw new Error(result.error || "The plugin request was refused.");
  }
  return result;
}
