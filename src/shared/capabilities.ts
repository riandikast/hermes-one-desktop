export interface DashboardSkill {
  name: string;
  enabled: boolean;
  usage: number;
  provenance: "bundled" | "hub" | "agent" | string;
  category: string;
  description: string;
}

export interface DashboardToolset {
  name: string;
  label: string;
  description: string;
  platform: string;
  enabled: boolean;
  available: boolean;
  configured: boolean;
  tools: string[];
}

export interface HubSkill {
  name: string;
  identifier: string;
  source: string;
  trustLevel: "builtin" | "trusted" | "community" | string;
  description: string;
}

export interface HubSource {
  id: string;
  label: string;
  available?: boolean;
  rateLimited?: boolean;
  searchable?: boolean;
}

export interface HubSourcesResult {
  sources: HubSource[];
  indexAvailable: boolean;
  featured: HubSkill[];
  installed: Record<string, { name: string }>;
}

export interface HubPreview {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trustLevel: string;
  repo?: string;
  tags: string[];
  skillMd: string;
  files: string[];
}

export interface HubScanFinding {
  severity: string;
  category: string;
  file: string;
  line: number | null;
  description: string;
}

export interface HubScan {
  name: string;
  identifier: string;
  source: string;
  trustLevel: string;
  verdict: string;
  summary: string;
  policy: "allow" | "ask" | "block";
  policyReason: string;
  findings: HubScanFinding[];
  severityCounts: Record<string, number>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function parseHubSkill(raw: unknown): HubSkill {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(r.name),
    identifier: str(r.identifier),
    source: str(r.source),
    trustLevel: str(r.trust_level) || "community",
    description: str(r.description),
  };
}

function parseHubSource(raw: unknown): HubSource {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    label: str(r.label),
    available: typeof r.available === "boolean" ? r.available : undefined,
    rateLimited: typeof r.rate_limited === "boolean" ? r.rate_limited : undefined,
    searchable: typeof r.searchable === "boolean" ? r.searchable : undefined,
  };
}

function parseHubSources(raw: unknown): HubSourcesResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sources = Array.isArray(r.sources) ? r.sources.map(parseHubSource) : [];
  const featured = Array.isArray(r.featured) ? r.featured.map(parseHubSkill) : [];
  const installed = (r.installed ?? {}) as Record<string, { name?: string }>;
  const installedMap: Record<string, { name: string }> = {};
  for (const [id, meta] of Object.entries(installed)) {
    installedMap[id] = { name: str(meta?.name) };
  }
  return {
    sources,
    indexAvailable: r.index_available === true,
    featured,
    installed: installedMap,
  };
}

function parseHubPreview(raw: unknown): HubPreview {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(r.name),
    description: str(r.description),
    source: str(r.source),
    identifier: str(r.identifier),
    trustLevel: str(r.trust_level) || "community",
    repo: typeof r.repo === "string" ? r.repo : undefined,
    tags: Array.isArray(r.tags) ? r.tags.map(str) : [],
    skillMd: str(r.skill_md),
    files: Array.isArray(r.files) ? r.files.map(str) : [],
  };
}

function parseHubScan(raw: unknown): HubScan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const findings = Array.isArray(r.findings)
    ? r.findings.map((f) => {
        const fr = (f ?? {}) as Record<string, unknown>;
        return {
          severity: str(fr.severity),
          category: str(fr.category),
          file: str(fr.file),
          line: typeof fr.line === "number" ? fr.line : null,
          description: str(fr.description),
        };
      })
    : [];
  const counts = (r.severity_counts ?? {}) as Record<string, unknown>;
  const severityCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) severityCounts[k] = num(v);
  return {
    name: str(r.name),
    identifier: str(r.identifier),
    source: str(r.source),
    trustLevel: str(r.trust_level) || "community",
    verdict: str(r.verdict),
    summary: str(r.summary),
    policy: r.policy === "allow" || r.policy === "block" ? r.policy : "ask",
    policyReason: str(r.policy_reason),
    findings,
    severityCounts,
  };
}

export {
  parseHubSkill,
  parseHubSource,
  parseHubSources,
  parseHubPreview,
  parseHubScan,
};
