import type {
  DashboardSkill,
  DashboardToolset,
  HubPreview,
  HubScan,
  HubSkill,
  HubSourcesResult,
} from "../shared/capabilities";
import {
  parseHubPreview,
  parseHubScan,
  parseHubSkill,
  parseHubSources,
} from "../shared/capabilities";
import { getConnectionConfig } from "./config";
import { dashboardRequestJson, getDashboardConnection } from "./dashboard";
import { remoteDashboardRequestJson } from "./remote-api";

function connectionOrThrow(profile?: string): { baseUrl: string; token: string } {
  const local = getDashboardConnection(profile);
  if (local) return local;
  throw new Error(
    "Hermes dashboard is not running. Open a chat first, then retry.",
  );
}

function isRemoteModeValue(): boolean {
  const mode = getConnectionConfig().mode;
  return mode === "remote" || mode === "ssh";
}

function mapSkill(r: Record<string, unknown>): DashboardSkill {
  return {
    name: String(r.name ?? ""),
    enabled: r.enabled === true,
    usage: typeof r.usage === "number" ? r.usage : 0,
    provenance: String(r.provenance ?? "bundled"),
    category: String(r.category ?? ""),
    description: String(r.description ?? ""),
  };
}

function mapToolset(r: Record<string, unknown>): DashboardToolset {
  return {
    name: String(r.name ?? ""),
    label: String(r.label ?? r.name ?? ""),
    description: String(r.description ?? ""),
    platform: String(r.platform ?? "cli"),
    enabled: r.enabled === true,
    available: r.available === true,
    configured: r.configured === true,
    tools: Array.isArray(r.tools) ? r.tools.map(String) : [],
  };
}

interface HubSearchPayload {
  results?: unknown[];
  installed?: Record<string, { name?: string }>;
  timed_out?: string[];
}

interface HubRequestOptions {
  method?: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  timeoutMs: number;
}

async function hubSearchRequest(
  path: string,
  options: HubRequestOptions,
  profile?: string,
): Promise<unknown> {
  if (isRemoteModeValue()) {
    return remoteDashboardRequestJson(
      getConnectionConfig(),
      path,
      options,
      profile,
    );
  }
  const conn = connectionOrThrow(profile);
  return dashboardRequestJson(conn.baseUrl, conn.token, path, options);
}

export async function getDashboardSkills(profile?: string): Promise<DashboardSkill[]> {
  if (isRemoteModeValue()) {
    const data = await remoteDashboardRequestJson<unknown[]>(
      getConnectionConfig(),
      "/api/skills",
      {},
      profile,
    );
    return (data ?? []).map((r) => mapSkill((r ?? {}) as Record<string, unknown>));
  }
  const conn = connectionOrThrow(profile);
  const data = await dashboardRequestJson<unknown[]>(conn.baseUrl, conn.token, "/api/skills", {
    timeoutMs: 8_000,
  });
  return (data ?? []).map((r) => mapSkill((r ?? {}) as Record<string, unknown>));
}

export async function setDashboardSkillEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  await hubSearchRequest(
    "/api/skills/toggle",
    { method: "PUT", body: { name, enabled }, timeoutMs: 8_000 },
    profile,
  );
  return true;
}

export async function getDashboardToolsets(profile?: string): Promise<DashboardToolset[]> {
  if (isRemoteModeValue()) {
    const data = await remoteDashboardRequestJson<unknown[]>(
      getConnectionConfig(),
      "/api/tools/toolsets",
      {},
      profile,
    );
    return (data ?? []).map((r) => mapToolset((r ?? {}) as Record<string, unknown>));
  }
  const conn = connectionOrThrow(profile);
  const data = await dashboardRequestJson<unknown[]>(conn.baseUrl, conn.token, "/api/tools/toolsets", {
    timeoutMs: 8_000,
  });
  return (data ?? []).map((r) => mapToolset((r ?? {}) as Record<string, unknown>));
}

export async function setDashboardToolsetEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  const path = `/api/tools/toolsets/${encodeURIComponent(name)}`;
  await hubSearchRequest(
    path,
    { method: "PUT", body: { enabled }, timeoutMs: 8_000 },
    profile,
  );
  return true;
}

export async function getHubSources(profile?: string): Promise<HubSourcesResult> {
  const raw = await hubSearchRequest(
    "/api/skills/hub/sources",
    { timeoutMs: 8_000 },
    profile,
  );
  return parseHubSources(raw);
}

export async function searchHubSkills(
  query: string,
  source = "all",
  limit = 20,
  profile?: string,
): Promise<{
  results: HubSkill[];
  installed: Record<string, { name: string }>;
  timedOut: string[];
}> {
  const params = new URLSearchParams({ q: query, source, limit: String(limit) });
  const raw = (await hubSearchRequest(
    `/api/skills/hub/search?${params.toString()}`,
    { timeoutMs: 35_000 },
    profile,
  )) as HubSearchPayload;
  const results = (raw.results ?? []).map(parseHubSkill);
  const installed: Record<string, { name: string }> = {};
  for (const [id, meta] of Object.entries(raw.installed ?? {})) {
    installed[id] = { name: String(meta?.name ?? "") };
  }
  return { results, installed, timedOut: raw.timed_out ?? [] };
}

export async function previewHubSkill(
  identifier: string,
  profile?: string,
): Promise<HubPreview> {
  const params = new URLSearchParams({ identifier });
  const raw = await hubSearchRequest(
    `/api/skills/hub/preview?${params.toString()}`,
    { timeoutMs: 15_000 },
    profile,
  );
  return parseHubPreview(raw);
}

export async function scanHubSkill(
  identifier: string,
  profile?: string,
): Promise<HubScan> {
  const params = new URLSearchParams({ identifier });
  const raw = await hubSearchRequest(
    `/api/skills/hub/scan?${params.toString()}`,
    { timeoutMs: 30_000 },
    profile,
  );
  return parseHubScan(raw);
}
