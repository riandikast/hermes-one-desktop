# Capabilities Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fork's Discover/Tools/Skills screens with one official-style "Capabilities" screen (master-detail, 4 tabs: Skills | Toolsets | MCP | Hub) backed by the official `hermes dashboard` REST API + CLI.

**Architecture:** The main process already spawns `hermes dashboard --no-open` (src/main/dashboard.ts) with a session token. We add a dashboard REST client layer (`src/main/dashboard-capabilities.ts`) that calls `GET /api/skills`, `PUT /api/skills/toggle`, `GET /api/tools/toolsets`, `PUT /api/tools/toolsets/{name}`, and hub endpoints (`/api/skills/hub/sources`, `/search`, `/preview`, `/scan`) with the `X-Hermes-Session-Token` header. Hub install/uninstall/update reuse the existing CLI wrappers in src/main/skills.ts. A new renderer screen `src/renderer/src/screens/Capabilities/Capabilities.tsx` renders the four tabs; Layout.tsx mounts it as the single "Capabilities" entry and the old screens are deleted.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript, vitest + @testing-library/react, i18next (shared/i18n), CSS in `src/renderer/src/assets/main.css`.

---

## File Structure

**New files:**
- `src/main/dashboard-capabilities.ts` — dashboard REST client (skills/toolsets/hub read+write endpoints) + types
- `src/main/dashboard-capabilities.test.ts` — client tests (URLs, payloads, token header, error handling)
- `src/renderer/src/screens/Capabilities/Capabilities.tsx` — the 4-tab master-detail screen
- `src/renderer/src/screens/Capabilities/Capabilities.test.tsx` — screen tests
- `src/shared/i18n/locales/en/capabilities.ts` — i18n strings

**Modified files:**
- `src/main/dashboard.ts` — export a `dashboardRequestJson` helper (generalizes private `requestJson` to support method/body) and `getDashboardConnection(profile)`
- `src/main/skills.ts` — remove dead `searchSkills`; add `installHubSkill`/`uninstallHubSkill`/`updateHubSkills` wrappers
- `src/main/ipc/register.ts` — register new IPC handlers
- `src/preload/index.ts` + `src/preload/index.d.ts` — expose new API methods
- `src/renderer/src/screens/Layout/Layout.tsx` — mount Capabilities, replace nav entries, keep `focusDiscover` → `focusCapabilities`
- `src/renderer/src/assets/main.css` — Capabilities styles (master-detail, hub rows, trust badges); remove old `.discover-`/`.skills-` styles after deletion
- `src/shared/i18n/locales/en/navigation.ts` — label stays `navigation.tools: "Capabilities"` (no change needed)

**Deleted files:**
- `src/renderer/src/screens/Discover/Discover.tsx`
- `src/renderer/src/screens/Tools/Tools.tsx`
- `src/renderer/src/screens/Skills/Skills.tsx` + `Skills.test.tsx`

**Shared types (src/shared/):** add `src/shared/capabilities.ts` with `DashboardSkill`, `DashboardToolset`, `HubSkill`, `HubSource`, `HubPreview`, `HubScan` types used by both main and renderer.

---

### Task 1: Shared capability types

**Files:**
- Create: `src/shared/capabilities.ts`
- Test: `src/shared/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseHubSkill, parseHubSources, parseHubPreview, parseHubScan } from "./capabilities";

describe("capabilities payload parsers", () => {
  it("parses a hub skill search result", () => {
    const raw = {
      name: "ocr",
      identifier: "skills-sh/mr-shaper/opencode-skills-paddle-ocr/ocr",
      source: "skills.sh",
      trust_level: "community",
      description: "Indexed by skills.sh",
    };
    expect(parseHubSkill(raw)).toEqual({
      name: "ocr",
      identifier: "skills-sh/mr-shaper/opencode-skills-paddle-ocr/ocr",
      source: "skills.sh",
      trustLevel: "community",
      description: "Indexed by skills.sh",
    });
  });

  it("defaults trust_level and missing fields", () => {
    const raw = { name: "x", identifier: "i" };
    expect(parseHubSkill(raw)).toEqual({
      name: "x",
      identifier: "i",
      source: "",
      trustLevel: "community",
      description: "",
    });
  });

  it("parses hub sources with flags", () => {
    const raw = {
      sources: [
        { id: "github", label: "GitHub", rate_limited: true },
        { id: "hermes-index", label: "Official", available: true, searchable: false },
      ],
      index_available: true,
      featured: [{ name: "pdf", identifier: "official/productivity/pdf", trust_level: "trusted" }],
      installed: { "official/productivity/pdf": { name: "pdf" } },
    };
    const parsed = parseHubSources(raw);
    expect(parsed.sources[0]).toMatchObject({ id: "github", rateLimited: true });
    expect(parsed.sources[1]).toMatchObject({ id: "hermes-index", searchable: false });
    expect(parsed.indexAvailable).toBe(true);
    expect(parsed.featured[0].trustLevel).toBe("trusted");
    expect(parsed.installed["official/productivity/pdf"].name).toBe("pdf");
  });

  it("parses a hub preview", () => {
    const raw = {
      name: "pdf",
      identifier: "official/productivity/pdf",
      description: "Create PDFs",
      source: "official",
      trust_level: "trusted",
      skill_md: "# PDF\nCreate and edit PDFs.",
      files: ["SKILL.md", "helper.py"],
    };
    expect(parseHubPreview(raw)).toMatchObject({
      name: "pdf",
      skillMd: "# PDF\nCreate and edit PDFs.",
      files: ["SKILL.md", "helper.py"],
    });
  });

  it("parses a hub scan result", () => {
    const raw = {
      name: "pdf",
      identifier: "i",
      trust_level: "community",
      verdict: "caution",
      summary: "Uses network",
      policy: "ask",
      severity_counts: { critical: 0, high: 1, medium: 0, low: 2 },
      findings: [{ severity: "high", file: "x.sh", line: 3, description: "curl" }],
    };
    const parsed = parseHubScan(raw);
    expect(parsed.policy).toBe("ask");
    expect(parsed.severityCounts.high).toBe(1);
    expect(parsed.findings[0].severity).toBe("high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/capabilities.test.ts`
Expected: FAIL with "Failed to resolve import ./capabilities"

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/capabilities.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/capabilities.ts src/shared/capabilities.test.ts
git commit -m "feat(shared): capability payload types + parsers"
```

---

### Task 2: Dashboard REST client

**Files:**
- Create: `src/main/dashboard-capabilities.ts`
- Test: `src/main/dashboard-capabilities.test.ts`
- Modify: `src/main/dashboard.ts:218-276` (generalize `requestJson` + export helpers)

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  getConnectionConfig: vi.fn(() => ({
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteAuthMode: "auto",
    ssh: {},
  })),
}));

vi.mock("./dashboard", () => ({
  getDashboardConnection: vi.fn(() => ({
    baseUrl: "http://127.0.0.1:9123",
    token: "test-token",
  })),
  dashboardRequestJson: vi.fn(),
}));

vi.mock("./remote-api", () => ({
  remoteDashboardRequestJson: vi.fn(),
}));

import { getConnectionConfig } from "./config";
import { dashboardRequestJson, getDashboardConnection } from "./dashboard";
import { remoteDashboardRequestJson } from "./remote-api";
import {
  getDashboardSkills,
  setDashboardSkillEnabled,
  getDashboardToolsets,
  setDashboardToolsetEnabled,
  getHubSources,
  searchHubSkills,
  previewHubSkill,
  scanHubSkill,
} from "./dashboard-capabilities";

const mockedGetConnection = vi.mocked(getConnectionConfig);
const mockedGetDashboardConnection = vi.mocked(getDashboardConnection);
const mockedDashboardRequest = vi.mocked(dashboardRequestJson);
const mockedRemoteRequest = vi.mocked(remoteDashboardRequestJson);

describe("dashboard-capabilities", () => {
  beforeEach(() => {
    mockedGetConnection.mockReturnValue({
      mode: "local",
      remoteUrl: "",
      apiKey: "",
      remoteAuthMode: "auto",
      ssh: {},
    });
    mockedGetDashboardConnection.mockReturnValue({
      baseUrl: "http://127.0.0.1:9123",
      token: "test-token",
    });
    mockedDashboardRequest.mockReset();
    mockedRemoteRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/skills passes the session token and maps rows", async () => {
    mockedDashboardRequest.mockResolvedValue([
      { name: "pdf", enabled: true, usage: 3, provenance: "bundled", category: "productivity", description: "PDF" },
    ]);
    const skills = await getDashboardSkills();
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/skills",
      expect.objectContaining({ timeoutMs: 8_000 }),
    );
    expect(skills[0]).toMatchObject({ name: "pdf", enabled: true, usage: 3, provenance: "bundled" });
  });

  it("PUT /api/skills/toggle sends name + enabled", async () => {
    mockedDashboardRequest.mockResolvedValue({ ok: true, name: "pdf", enabled: false });
    await setDashboardSkillEnabled("pdf", false);
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/skills/toggle",
      expect.objectContaining({ method: "PUT", body: { name: "pdf", enabled: false } }),
    );
  });

  it("GET /api/tools/toolsets maps rows", async () => {
    mockedDashboardRequest.mockResolvedValue([
      { name: "terminal", label: "Terminal", description: "Shell", platform: "cli", enabled: true, available: true, configured: true, tools: ["run_shell"] },
    ]);
    const toolsets = await getDashboardToolsets();
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/tools/toolsets",
      expect.anything(),
    );
    expect(toolsets[0]).toMatchObject({ name: "terminal", enabled: true, tools: ["run_shell"], configured: true });
  });

  it("PUT /api/tools/toolsets/{name} sends enabled", async () => {
    mockedDashboardRequest.mockResolvedValue({ ok: true, name: "terminal", platform: "cli", enabled: false });
    await setDashboardToolsetEnabled("terminal", false);
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/tools/toolsets/terminal",
      expect.objectContaining({ method: "PUT", body: { enabled: false } }),
    );
  });

  it("hub sources, search, preview, scan hit the right paths", async () => {
    mockedDashboardRequest.mockResolvedValueOnce({ sources: [], index_available: false, featured: [], installed: {} });
    await getHubSources();
    expect(mockedDashboardRequest).toHaveBeenNthCalledWith(
      1, "http://127.0.0.1:9123", "test-token", "/api/skills/hub/sources", expect.anything(),
    );

    mockedDashboardRequest.mockResolvedValueOnce({ results: [], source_counts: {}, timed_out: [], installed: {} });
    await searchHubSkills("ocr", "all", 20);
    const searchCall = mockedDashboardRequest.mock.calls[1][2] as string;
    expect(searchCall).toContain("/api/skills/hub/search");
    expect(searchCall).toContain("q=ocr");

    mockedDashboardRequest.mockResolvedValueOnce({ name: "pdf", identifier: "i", trust_level: "trusted", skill_md: "# PDF", files: [] });
    await previewHubSkill("i");
    const previewCall = mockedDashboardRequest.mock.calls[2][2] as string;
    expect(previewCall).toContain("/api/skills/hub/preview");
    expect(previewCall).toContain("identifier=i");

    mockedDashboardRequest.mockResolvedValueOnce({ name: "pdf", identifier: "i", verdict: "safe", policy: "allow", findings: [], severity_counts: {} });
    await scanHubSkill("i");
    const scanCall = mockedDashboardRequest.mock.calls[3][2] as string;
    expect(scanCall).toContain("/api/skills/hub/scan");
  });

  it("parses a hub search result with installed map and timedOut", async () => {
    mockedDashboardRequest.mockResolvedValue({
      results: [{ name: "ocr", identifier: "i", trust_level: "community", description: "OCR" }],
      timed_out: ["github"],
      installed: { i: { name: "ocr" } },
    });
    const out = await searchHubSkills("ocr");
    expect(out.results[0].trustLevel).toBe("community");
    expect(out.timedOut).toEqual(["github"]);
    expect(out.installed.i.name).toBe("ocr");
  });

  it("throws a readable error when the dashboard is not running", async () => {
    mockedGetDashboardConnection.mockReturnValue(null);
    await expect(getDashboardSkills()).rejects.toThrow(/dashboard/i);
  });

  it("throws when the backend returns a non-ok status", async () => {
    mockedDashboardRequest.mockRejectedValue(new Error("500: boom"));
    await expect(getDashboardSkills()).rejects.toThrow(/500/);
  });

  it("routes through the remote API in remote mode", async () => {
    mockedGetConnection.mockReturnValue({
      mode: "remote",
      remoteUrl: "https://remote.example",
      apiKey: "k",
      remoteAuthMode: "token",
      ssh: {},
    });
    mockedRemoteRequest.mockResolvedValue([{ name: "pdf", enabled: true, usage: 0, provenance: "bundled", category: "c", description: "d" }]);
    const skills = await getDashboardSkills("p");
    expect(mockedRemoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/skills",
      expect.anything(),
      "p",
    );
    expect(skills[0].name).toBe("pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/dashboard-capabilities.test.ts`
Expected: FAIL with "Failed to resolve import ./dashboard-capabilities"

- [ ] **Step 3: Generalize requestJson in dashboard.ts**

In `src/main/dashboard.ts`, replace the private `requestJson` (lines 218-276) with a general exported helper. Edit the function so it accepts `method` and `body`:

```ts
export function dashboardRequestJson<T = unknown>(
  baseUrl: string,
  token: string,
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const client = url.protocol === "https:" ? https : http;
    const bodyBuf = options.body !== undefined ? Buffer.from(JSON.stringify(options.body)) : null;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Hermes-Session-Token": token,
    };
    if (bodyBuf) headers["Content-Length"] = String(bodyBuf.length);
    const req = client.request(
      url,
      { method: options.method ?? "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`${res.statusCode}: ${text || res.statusMessage}`));
            return;
          }
          if (!text) {
            resolve(null as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new Error(`Invalid JSON from ${url} (status ${res.statusCode}): ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(options.timeoutMs ?? 2_000, () => {
      req.destroy(new Error(`Timed out connecting to Hermes dashboard after ${options.timeoutMs ?? 2_000}ms`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}
```

Keep the existing `requestJson` function delegating to it (so probe/status callers are untouched):

```ts
function requestJson(url: string, token: string, timeoutMs = 2_000): Promise<unknown> {
  const parsed = new URL(url);
  return dashboardRequestJson(
    parsed.origin,
    token,
    `${parsed.pathname}${parsed.search}`,
    { timeoutMs },
  );
}
```

Then add the connection accessor near the bottom of `dashboard.ts` (after `stopAllDashboards`):

```ts
export function getDashboardConnection(
  profile?: string,
): { baseUrl: string; token: string } | null {
  const managed = getManagedDashboard(profile);
  if (!managed) return null;
  return { baseUrl: managed.connection.baseUrl, token: managed.connection.token };
}
```

Note: `getManagedDashboard` is already defined in the file (check the current name — it may be `dashboards.get`). If no `getManagedDashboard` helper exists, read the `dashboards` Map directly:

```ts
export function getDashboardConnection(
  profile?: string,
): { baseUrl: string; token: string } | null {
  const key = profileKey(profile);
  const managed = dashboards.get(key);
  if (!managed) return null;
  return { baseUrl: managed.connection.baseUrl, token: managed.connection.token };
}
```

- [ ] **Step 4: Write the client module**

Create `src/main/dashboard-capabilities.ts`:

```ts
import type {
  DashboardSkill,
  DashboardToolset,
  HubPreview,
  HubScan,
  HubSkill,
  HubSourcesResult,
} from "../shared/capabilities";
import { parseHubPreview, parseHubScan, parseHubSkill, parseHubSources } from "../shared/capabilities";
import { getConnectionConfig } from "./config";
import { dashboardRequestJson, getDashboardConnection } from "./dashboard";
import { remoteDashboardRequestJson } from "./remote-api";

function connectionOrThrow(profile?: string): { baseUrl: string; token: string } {
  const local = getDashboardConnection(profile);
  if (local) return local;
  throw new Error("Hermes dashboard is not running. Open a chat first, then retry.");
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

export async function getDashboardSkills(profile?: string): Promise<DashboardSkill[]> {
  if (isRemoteModeValue()) {
    const data = await remoteDashboardRequestJson<unknown[]>(getConnectionConfig(), "/api/skills", {}, profile);
    return (data ?? []).map((r) => mapSkill((r ?? {}) as Record<string, unknown>));
  }
  const conn = connectionOrThrow(profile);
  const data = await dashboardRequestJson<unknown[]>(conn.baseUrl, conn.token, "/api/skills", { timeoutMs: 8_000 });
  return (data ?? []).map((r) => mapSkill((r ?? {}) as Record<string, unknown>));
}

export async function setDashboardSkillEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  if (isRemoteModeValue()) {
    await remoteDashboardRequestJson(getConnectionConfig(), "/api/skills/toggle", {
      method: "PUT",
      body: { name, enabled },
    }, profile);
    return true;
  }
  const conn = connectionOrThrow(profile);
  await dashboardRequestJson(conn.baseUrl, conn.token, "/api/skills/toggle", {
    method: "PUT",
    body: { name, enabled },
    timeoutMs: 8_000,
  });
  return true;
}

export async function getDashboardToolsets(profile?: string): Promise<DashboardToolset[]> {
  if (isRemoteModeValue()) {
    const data = await remoteDashboardRequestJson<unknown[]>(getConnectionConfig(), "/api/tools/toolsets", {}, profile);
    return (data ?? []).map((r) => mapToolset((r ?? {}) as Record<string, unknown>));
  }
  const conn = connectionOrThrow(profile);
  const data = await dashboardRequestJson<unknown[]>(conn.baseUrl, conn.token, "/api/tools/toolsets", { timeoutMs: 8_000 });
  return (data ?? []).map((r) => mapToolset((r ?? {}) as Record<string, unknown>));
}

export async function setDashboardToolsetEnabled(
  name: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  const path = `/api/tools/toolsets/${encodeURIComponent(name)}`;
  if (isRemoteModeValue()) {
    await remoteDashboardRequestJson(getConnectionConfig(), path, {
      method: "PUT",
      body: { enabled },
    }, profile);
    return true;
  }
  const conn = connectionOrThrow(profile);
  await dashboardRequestJson(conn.baseUrl, conn.token, path, {
    method: "PUT",
    body: { enabled },
    timeoutMs: 8_000,
  });
  return true;
}

export async function getHubSources(profile?: string): Promise<HubSourcesResult> {
  if (isRemoteModeValue()) {
    const data = await remoteDashboardRequestJson<unknown>(getConnectionConfig(), "/api/skills/hub/sources", {}, profile);
    return parseHubSources(data);
  }
  const conn = connectionOrThrow(profile);
  const data = await dashboardRequestJson<unknown>(conn.baseUrl, conn.token, "/api/skills/hub/sources", { timeoutMs: 8_000 });
  return parseHubSources(data);
}

export async function searchHubSkills(
  query: string,
  source = "all",
  limit = 20,
  profile?: string,
): Promise<{ results: HubSkill[]; installed: Record<string, { name: string }>; timedOut: string[] }> {
  const params = new URLSearchParams({ q: query, source, limit: String(limit) });
  const path = `/api/skills/hub/search?${params.toString()}`;
  const raw = isRemoteModeValue()
    ? await remoteDashboardRequestJson<{
        results?: unknown[];
        installed?: Record<string, { name?: string }>;
        timed_out?: string[];
      }>(getConnectionConfig(), path, { timeoutMs: 35_000 }, profile)
    : await dashboardRequestJson<{
        results?: unknown[];
        installed?: Record<string, { name?: string }>;
        timed_out?: string[];
      }>(connectionOrThrow(profile).baseUrl, connectionOrThrow(profile).token, path, { timeoutMs: 35_000 });
  const results = (raw.results ?? []).map(parseHubSkill);
  const installed: Record<string, { name: string }> = {};
  for (const [id, meta] of Object.entries(raw.installed ?? {})) {
    installed[id] = { name: String(meta?.name ?? "") };
  }
  return { results, installed, timedOut: raw.timed_out ?? [] };
}

export async function previewHubSkill(identifier: string, profile?: string): Promise<HubPreview> {
  const params = new URLSearchParams({ identifier });
  const path = `/api/skills/hub/preview?${params.toString()}`;
  const raw = isRemoteModeValue()
    ? await remoteDashboardRequestJson<unknown>(getConnectionConfig(), path, { timeoutMs: 15_000 }, profile)
    : await dashboardRequestJson<unknown>(connectionOrThrow(profile).baseUrl, connectionOrThrow(profile).token, path, { timeoutMs: 15_000 });
  return parseHubPreview(raw);
}

export async function scanHubSkill(identifier: string, profile?: string): Promise<HubScan> {
  const params = new URLSearchParams({ identifier });
  const path = `/api/skills/hub/scan?${params.toString()}`;
  const raw = isRemoteModeValue()
    ? await remoteDashboardRequestJson<unknown>(getConnectionConfig(), path, { timeoutMs: 30_000 }, profile)
    : await dashboardRequestJson<unknown>(connectionOrThrow(profile).baseUrl, connectionOrThrow(profile).token, path, { timeoutMs: 30_000 });
  return parseHubScan(raw);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/dashboard-capabilities.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck:node`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/dashboard.ts src/main/dashboard-capabilities.ts src/main/dashboard-capabilities.test.ts
git commit -m "feat(main): dashboard REST client for skills, toolsets, and the skill hub"
```

---

### Task 3: Skill hub CLI wrappers + remove dead searchSkills

**Files:**
- Modify: `src/main/skills.ts`
- Test: `src/main/skills.test.ts` (create if missing; verify `classifySkillCliOutput` still passes)

- [ ] **Step 1: Remove the dead searchSkills**

Delete the `searchSkills` function (currently lines 207-253 in `src/main/skills.ts`) — it uses the removed `browse --query --json` flag and always returns `[]` on modern CLIs. No replacement is needed: hub search now goes through `searchHubSkills` (Task 2).

Also delete the now-unused import of `homedir` from "os" IF nothing else uses it (check the file first — it is used by the env builders, so leave the import in place unless the compiler complains).

- [ ] **Step 2: Write the failing tests**

Create `src/main/skills.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => {
  const actual = vi.importActual("child_process");
  return { ...actual, execFileSync: vi.fn() };
});
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/h",
  HERMES_REPO: "/tmp/r",
  HERMES_PYTHON: "python3",
  hermesCliArgs: (args: string[]) => args,
  getEnhancedPath: () => "",
}));
vi.mock("./utils", () => ({
  profileHome: vi.fn(() => "/tmp/h"),
  isValidNamedProfileName: () => true,
}));

import { execFileSync } from "child_process";
import { installHubSkill, uninstallHubSkill, updateHubSkills } from "./skills";

const mockedExec = vi.mocked(execFileSync);

describe("skill hub CLI wrappers", () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("installHubSkill runs hermes skills install <id> --yes", () => {
    mockedExec.mockReturnValue(Buffer.from("Installed ok"));
    const result = installHubSkill("skills-sh/x/y");
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "install", "skills-sh/x/y", "--yes"]),
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it("uninstallHubSkill runs hermes skills uninstall <name> --yes", () => {
    mockedExec.mockReturnValue(Buffer.from("ok"));
    const result = uninstallHubSkill("pdf");
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "uninstall", "pdf", "--yes"]),
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it("updateHubSkills runs hermes skills update and classifies failures", () => {
    mockedExec.mockReturnValue(Buffer.from("No skill named bogus"));
    const result = updateHubSkills();
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "update"]),
      expect.anything(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("No skill named");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/skills.test.ts`
Expected: FAIL — `installHubSkill is not a function`

- [ ] **Step 4: Write the wrappers**

Append to `src/main/skills.ts` (after `uninstallSkill`, reusing the same env/exec pattern):

```ts
/**
 * Install a skill from the hub by its full identifier (e.g.
 * "skills-sh/nousresearch/hermes-agent/ocr-and-documents").
 */
export function installHubSkill(
  identifier: string,
  profile?: string,
): SkillCliResult {
  try {
    const args = hermesCliArgs(["skills", "install", identifier, "--yes"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    const stdout = execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 60_000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    return classifySkillCliOutput(stdout?.toString() ?? "");
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const msg = (e.stderr?.toString() || e.message || "").trim();
    return {
      success: false,
      error: msg || e.stdout?.toString()?.trim() || "Install failed.",
    };
  }
}

/**
 * Update all outdated hub skills. The CLI takes no --yes flag (verified
 * against the installed CLI); failures are classified the same way as
 * install/uninstall.
 */
export function updateHubSkills(profile?: string): SkillCliResult {
  try {
    const args = hermesCliArgs(["skills", "update"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    const stdout = execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 90_000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    return classifySkillCliOutput(stdout?.toString() ?? "");
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const msg = (e.stderr?.toString() || e.message || "").trim();
    return {
      success: false,
      error: msg || e.stdout?.toString()?.trim() || "Update failed.",
    };
  }
}
```

Note: `uninstallHubSkill` can simply delegate to the existing `uninstallSkill` — add an alias:

```ts
/** Alias for the hub UI — uninstalls by name via the existing path. */
export function uninstallHubSkill(name: string, profile?: string): SkillCliResult {
  return uninstallSkill(name, profile);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/skills.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/skills.ts src/main/skills.test.ts
git commit -m "feat(main): hub skill install/update CLI wrappers; drop dead browse search"
```

---

### Task 4: IPC + preload surface

**Files:**
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add IPC handlers**

In `src/main/ipc/register.ts`, import the new functions at the top (near line 354-372 where skills functions are imported):

```ts
import {
  getDashboardSkills,
  getDashboardToolsets,
  getHubSources,
  previewHubSkill,
  scanHubSkill,
  searchHubSkills,
  setDashboardSkillEnabled,
  setDashboardToolsetEnabled,
} from "../dashboard-capabilities";
import { installHubSkill, uninstallHubSkill, updateHubSkills } from "../skills";
```

Register handlers right after the existing `uninstall-skill` handler (near line 2489):

```ts
  // Capabilities — dashboard REST + hub CLI
  ipcMain.handle("get-dashboard-skills", (_event, profile?: string) =>
    getDashboardSkills(profile),
  );
  ipcMain.handle(
    "set-dashboard-skill-enabled",
    (_event, name: string, enabled: boolean, profile?: string) =>
      setDashboardSkillEnabled(name, enabled, profile),
  );
  ipcMain.handle("get-dashboard-toolsets", (_event, profile?: string) =>
    getDashboardToolsets(profile),
  );
  ipcMain.handle(
    "set-dashboard-toolset-enabled",
    (_event, name: string, enabled: boolean, profile?: string) =>
      setDashboardToolsetEnabled(name, enabled, profile),
  );
  ipcMain.handle("get-hub-sources", (_event, profile?: string) =>
    getHubSources(profile),
  );
  ipcMain.handle(
    "search-hub-skills",
    (_event, query: string, source?: string, limit?: number, profile?: string) =>
      searchHubSkills(query, source, limit, profile),
  );
  ipcMain.handle(
    "preview-hub-skill",
    (_event, identifier: string, profile?: string) =>
      previewHubSkill(identifier, profile),
  );
  ipcMain.handle(
    "scan-hub-skill",
    (_event, identifier: string, profile?: string) =>
      scanHubSkill(identifier, profile),
  );
  ipcMain.handle("install-hub-skill", (_event, identifier: string, _profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshInstallSkill(conn.ssh, identifier);
    if (conn.mode === "remote")
      return remoteInstallSkill(identifier, activeSshProfile(_profile));
    return installHubSkill(identifier, _profile);
  });
  ipcMain.handle("uninstall-hub-skill", (_event, name: string, _profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshUninstallSkill(conn.ssh, name);
    if (conn.mode === "remote")
      return remoteUninstallSkill(name, activeSshProfile(_profile));
    return uninstallHubSkill(name, _profile);
  });
  ipcMain.handle("update-hub-skills", (_event, profile?: string) =>
    updateHubSkills(profile),
  );
```

- [ ] **Step 2: Add preload methods**

In `src/preload/index.ts`, after the existing `uninstallSkill` (line ~1119), add:

```ts
  // Capabilities — dashboard skills/toolsets + skill hub
  getDashboardSkills: (profile?: string): Promise<
    Array<{
      name: string;
      enabled: boolean;
      usage: number;
      provenance: string;
      category: string;
      description: string;
    }>
  > => ipcRenderer.invoke("get-dashboard-skills", profile),
  setDashboardSkillEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-dashboard-skill-enabled", name, enabled, profile),
  getDashboardToolsets: (profile?: string): Promise<
    Array<{
      name: string;
      label: string;
      description: string;
      platform: string;
      enabled: boolean;
      available: boolean;
      configured: boolean;
      tools: string[];
    }>
  > => ipcRenderer.invoke("get-dashboard-toolsets", profile),
  setDashboardToolsetEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-dashboard-toolset-enabled", name, enabled, profile),
  getHubSources: (profile?: string): Promise<{
    sources: Array<{
      id: string;
      label: string;
      available?: boolean;
      rateLimited?: boolean;
      searchable?: boolean;
    }>;
    indexAvailable: boolean;
    featured: Array<{
      name: string;
      identifier: string;
      source: string;
      trustLevel: string;
      description: string;
    }>;
    installed: Record<string, { name: string }>;
  }> => ipcRenderer.invoke("get-hub-sources", profile),
  searchHubSkills: (
    query: string,
    source?: string,
    limit?: number,
    profile?: string,
  ): Promise<{
    results: Array<{
      name: string;
      identifier: string;
      source: string;
      trustLevel: string;
      description: string;
    }>;
    installed: Record<string, { name: string }>;
    timedOut: string[];
  }> =>
    ipcRenderer.invoke("search-hub-skills", query, source, limit, profile),
  previewHubSkill: (
    identifier: string,
    profile?: string,
  ): Promise<{
    name: string;
    description: string;
    source: string;
    identifier: string;
    trustLevel: string;
    repo?: string;
    tags: string[];
    skillMd: string;
    files: string[];
  }> => ipcRenderer.invoke("preview-hub-skill", identifier, profile),
  scanHubSkill: (
    identifier: string,
    profile?: string,
  ): Promise<{
    name: string;
    identifier: string;
    source: string;
    trustLevel: string;
    verdict: string;
    summary: string;
    policy: string;
    policyReason: string;
    findings: Array<{
      severity: string;
      category: string;
      file: string;
      line: number | null;
      description: string;
    }>;
    severityCounts: Record<string, number>;
  }> => ipcRenderer.invoke("scan-hub-skill", identifier, profile),
  installHubSkill: (
    identifier: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("install-hub-skill", identifier, profile),
  uninstallHubSkill: (
    name: string,
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("uninstall-hub-skill", name, profile),
  updateHubSkills: (
    profile?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("update-hub-skills", profile),
```

- [ ] **Step 3: Add preload type declarations**

In `src/preload/index.d.ts`, after the skills section (line ~840), add the same methods with types (mirror the index.ts signatures exactly). If the file has an `interface HermesAPI` shape, add them inside it; if it's a `type`, add accordingly. The renderer imports `HermesAPI` from this file — keep the member names identical to `src/preload/index.ts`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:node && npm run typecheck:web`
Expected: no errors

- [ ] **Step 5: Run the shared + main tests**

Run: `npx vitest run src/shared/capabilities.test.ts src/main/dashboard-capabilities.test.ts src/main/skills.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/register.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(ipc): capabilities REST + hub CLI handlers"
```

---

### Task 5: Capabilities screen (part 1 — Skills + Toolsets tabs)

**Files:**
- Create: `src/renderer/src/screens/Capabilities/Capabilities.tsx`
- Create: `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
- Create: `src/shared/i18n/locales/en/capabilities.ts`

- [ ] **Step 1: Write the i18n file**

Create `src/shared/i18n/locales/en/capabilities.ts`:

```ts
export default {
  title: "Capabilities",
  subtitle: "Manage your agent's skills, toolsets, MCP servers, and the skill hub",
  refresh: "Refresh",
  tabs: {
    skills: "Skills",
    toolsets: "Toolsets",
    mcp: "MCP",
    hub: "Hub",
  },
  searchSkills: "Search skills...",
  searchToolsets: "Search toolsets...",
  searchHub: "Search the skill hub...",
  trust: {
    builtin: "Builtin",
    trusted: "Trusted",
    community: "Community",
  },
  provenance: {
    bundled: "bundled",
    hub: "hub",
    learned: "learned",
  },
  installed: "Installed",
  uninstall: "Uninstall",
  uninstalling: "Uninstalling...",
  install: "Install",
  installing: "Installing...",
  preview: "Preview",
  scan: "Scan",
  scanning: "Scanning...",
  updateAll: "Update all",
  updating: "Updating...",
  noSkills: "No skills found",
  noSkillsQuery: "No skills match your search",
  noToolsets: "No toolsets found",
  noToolsetsQuery: "No toolsets match your search",
  noHubResults: "No skills match your search in the hub",
  hubLanding: "Search 90,000+ skills from skills.sh, official Hermes, GitHub, and more",
  changesApplyNewSessions: "Changes apply to new conversations",
  hubSources: "Connected hubs",
  searchHint: "Try searching for a skill name, category, or tool",
  resultCount: "{{count}} results",
  featured: "Featured skills",
  searching: "Searching...",
  policy: {
    allow: "Safe to install",
    ask: "Review before install",
    block: "Blocked",
  },
  verdict: {
    safe: "Safe",
    dangerous: "Dangerous",
    caution: "Caution",
  },
  findings: "{{count}} findings",
  noFindings: "No findings",
  files: "Files",
  noReadme: "No SKILL.md preview available",
  emptyState: "Nothing here yet",
  loadFailed: "Couldn't load capabilities",
  retry: "Retry",
  needsKeys: "Needs API keys",
  tools: "Tools",
  togglingSkill: "Toggling skill...",
  togglingToolset: "Toggling toolset...",
  skillDetail: "Skill details",
  toolsetDetail: "Toolset details",
  category: "Category",
  usage: "Used {{count}}x",
} as const;
```

- [ ] **Step 2: Write the failing renderer tests**

Create `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`:

```tsx
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: () => {} }),
}));
vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ content }: { content: string }) => <pre>{content}</pre>,
}));
vi.mock("../../components/OrbLoader", () => ({
  OrbLoader: () => <div data-testid="orb-loader" />,
}));

import Capabilities from "./Capabilities";

const MOCK_SKILLS = [
  {
    name: "pdf",
    enabled: true,
    usage: 3,
    provenance: "bundled",
    category: "productivity",
    description: "Create and edit PDF files",
  },
  {
    name: "ocr-and-documents",
    enabled: false,
    usage: 0,
    provenance: "bundled",
    category: "productivity",
    description: "Extract text from PDFs and scans",
  },
];

const MOCK_TOOLSETS = [
  {
    name: "terminal",
    label: "Terminal",
    description: "Execute shell commands",
    platform: "cli",
    enabled: true,
    available: true,
    configured: true,
    tools: ["run_shell"],
  },
  {
    name: "vision",
    label: "Vision",
    description: "Analyze images",
    platform: "cli",
    enabled: false,
    available: true,
    configured: false,
    tools: ["read_image"],
  },
];

const MOCK_SOURCES = {
  sources: [
    { id: "hermes-index", label: "Official", available: true, searchable: false },
    { id: "skills-sh", label: "skills.sh", searchable: false },
  ],
  indexAvailable: true,
  featured: [
    {
      name: "pdf",
      identifier: "official/productivity/pdf",
      source: "official",
      trustLevel: "trusted",
      description: "Create PDFs",
    },
  ],
  installed: { "official/productivity/pdf": { name: "pdf" } },
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getDashboardSkills: vi.fn().mockResolvedValue(MOCK_SKILLS),
    setDashboardSkillEnabled: vi.fn().mockResolvedValue(true),
    getDashboardToolsets: vi.fn().mockResolvedValue(MOCK_TOOLSETS),
    setDashboardToolsetEnabled: vi.fn().mockResolvedValue(true),
    getHubSources: vi.fn().mockResolvedValue(MOCK_SOURCES),
    searchHubSkills: vi.fn().mockResolvedValue({ results: [], installed: {}, timedOut: [] }),
    previewHubSkill: vi.fn().mockResolvedValue({
      name: "pdf",
      description: "Create PDFs",
      source: "official",
      identifier: "official/productivity/pdf",
      trustLevel: "trusted",
      skillMd: "# PDF\nCreate and edit.",
      files: ["SKILL.md"],
    }),
    scanHubSkill: vi.fn().mockResolvedValue({
      name: "pdf",
      identifier: "i",
      trustLevel: "trusted",
      verdict: "safe",
      summary: "",
      policy: "allow",
      policyReason: "",
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    }),
    installHubSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallHubSkill: vi.fn().mockResolvedValue({ success: true }),
    updateHubSkills: vi.fn().mockResolvedValue({ success: true }),
    listMcpServers: vi.fn().mockResolvedValue([]),
    listInstalledSkills: vi.fn().mockResolvedValue([
      { name: "pdf", category: "productivity", description: "Create PDFs", path: "/skills/productivity/pdf" },
    ]),
    fetchRegistry: vi.fn().mockResolvedValue({ skills: [], mcps: [], agents: [], workflows: [] }),
    getSkillContent: vi.fn().mockResolvedValue("# pdf\ncontent"),
    installSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallSkill: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function mountWith(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: makeApi(overrides),
  });
  return render(<Capabilities profile="default" />);
}

describe("Capabilities — Skills tab", () => {
  it("renders skill rows with name, category, and provenance", async () => {
    const view = mountWith();
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    expect(view.getByText("ocr-and-documents")).toBeTruthy();
    // Mock t() returns the key: "capabilities.provenance.bundled"
    expect(view.getByText("capabilities.provenance.bundled")).toBeTruthy();
  });

  it("toggles a skill via setDashboardSkillEnabled (optimistic)", async () => {
    const setEnabled = vi.fn().mockResolvedValue(true);
    const view = mountWith({ setDashboardSkillEnabled: setEnabled });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const toggles = view.container.querySelectorAll(".cap-toggle input");
    await act(async () => {
      fireEvent.click(toggles[1] as HTMLInputElement);
    });
    expect(setEnabled).toHaveBeenCalledWith("ocr-and-documents", true, "default");
  });
});

describe("Capabilities — Toolsets tab", () => {
  it("renders toolsets and toggles them", async () => {
    const setToolset = vi.fn().mockResolvedValue(true);
    const view = mountWith({ setDashboardToolsetEnabled: setToolset });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[1] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("Terminal")).toBeTruthy());
    await waitFor(() => expect(view.getByText("Vision")).toBeTruthy());
    const toggles = view.container.querySelectorAll(".cap-toggle input");
    await act(async () => {
      fireEvent.click(toggles[1] as HTMLInputElement);
    });
    expect(setToolset).toHaveBeenCalledWith("vision", true, "default");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: FAIL — "Failed to resolve import ./Capabilities"

- [ ] **Step 4: Implement the screen (Skills + Toolsets tabs)**

Create `src/renderer/src/screens/Capabilities/Capabilities.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Refresh, X } from "../../assets/icons";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import type {
  DashboardSkill,
  DashboardToolset,
} from "../../../../shared/capabilities";

export type CapabilityTab = "skills" | "toolsets" | "mcp" | "hub";

interface CapabilitiesProps {
  profile?: string;
  visible?: boolean;
  focusTab?: { tab: CapabilityTab; nonce: number };
}

const TRUST_TONES: Record<string, string> = {
  builtin: "cap-badge cap-badge--builtin",
  trusted: "cap-badge cap-badge--trusted",
  community: "cap-badge cap-badge--community",
};

export function trustTone(trustLevel: string): string {
  return TRUST_TONES[trustLevel] ?? "cap-badge cap-badge--community";
}

export default function Capabilities({
  profile,
  visible = true,
  focusTab,
}: CapabilitiesProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<CapabilityTab>("skills");
  const [skills, setSkills] = useState<DashboardSkill[]>([]);
  const [toolsets, setToolsets] = useState<DashboardToolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [toolsetBusy, setToolsetBusy] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<DashboardSkill | null>(null);
  const [detailToolset, setDetailToolset] = useState<DashboardToolset | null>(null);
  const [skillContent, setSkillContent] = useState("");

  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab.tab);
  }, [focusTab]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [s, ts] = await Promise.all([
        window.hermesAPI.getDashboardSkills(profile),
        window.hermesAPI.getDashboardToolsets(profile),
      ]);
      setSkills(s);
      setToolsets(ts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const filteredToolsets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return toolsets;
    return toolsets.filter(
      (ts) =>
        ts.name.toLowerCase().includes(q) ||
        ts.label.toLowerCase().includes(q) ||
        ts.description.toLowerCase().includes(q) ||
        ts.tools.some((tool) => tool.toLowerCase().includes(q)),
    );
  }, [toolsets, query]);

  const handleToggleSkill = useCallback(
    async (skill: DashboardSkill): Promise<void> => {
      const next = !skill.enabled;
      setSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? { ...s, enabled: next } : s)),
      );
      setSkillBusy(skill.name);
      try {
        await window.hermesAPI.setDashboardSkillEnabled(skill.name, next, profile);
      } catch (err) {
        setSkills((prev) =>
          prev.map((s) =>
            s.name === skill.name ? { ...s, enabled: !next } : s,
          ),
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSkillBusy(null);
      }
    },
    [profile],
  );

  const handleToggleToolset = useCallback(
    async (toolset: DashboardToolset): Promise<void> => {
      const next = !toolset.enabled;
      setToolsets((prev) =>
        prev.map((ts) =>
          ts.name === toolset.name ? { ...ts, enabled: next } : ts,
        ),
      );
      setToolsetBusy(toolset.name);
      try {
        await window.hermesAPI.setDashboardToolsetEnabled(toolset.name, next, profile);
      } catch (err) {
        setToolsets((prev) =>
          prev.map((ts) =>
            ts.name === toolset.name ? { ...ts, enabled: !next } : ts,
          ),
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setToolsetBusy(null);
      }
    },
    [profile],
  );

  const openSkillDetail = useCallback(
    async (skill: DashboardSkill): Promise<void> => {
      setDetailSkill(skill);
      setSkillContent("");
      try {
        // Resolve the local SKILL.md path via the installed-skills list (the
        // REST payload has no filesystem path).
        const installed = await window.hermesAPI.listInstalledSkills(profile);
        const match = installed.find((s) => s.name === skill.name);
        if (match) {
          setSkillContent(await window.hermesAPI.getSkillContent(match.path));
        }
      } catch {
        /* leave detail content empty */
      }
    },
    [profile],
  );

  const searchVisible = tab !== "mcp";

  return (
    <div className="cap-container">
      <div className="cap-header">
        <div>
          <h1 className="cap-title">{t("capabilities.title")}</h1>
          <p className="cap-subtitle">{t("capabilities.subtitle")}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
          <Refresh size={14} />
          {t("capabilities.refresh")}
        </button>
      </div>

      <div className="cap-tabs">
        <button
          type="button"
          className={`cap-tab ${tab === "skills" ? "active" : ""}`}
          onClick={() => setTab("skills")}
        >
          {t("capabilities.tabs.skills")}
          <span className="cap-tab-count">{skills.length}</span>
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "toolsets" ? "active" : ""}`}
          onClick={() => setTab("toolsets")}
        >
          {t("capabilities.tabs.toolsets")}
          <span className="cap-tab-count">{toolsets.length}</span>
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "mcp" ? "active" : ""}`}
          onClick={() => setTab("mcp")}
        >
          {t("capabilities.tabs.mcp")}
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "hub" ? "active" : ""}`}
          onClick={() => setTab("hub")}
        >
          {t("capabilities.tabs.hub")}
        </button>
      </div>

      {searchVisible && (
        <div className="cap-search">
          <Search size={15} />
          <input
            className="cap-search-input"
            value={query}
            placeholder={
              tab === "skills"
                ? t("capabilities.searchSkills")
                : tab === "toolsets"
                  ? t("capabilities.searchToolsets")
                  : t("capabilities.searchHub")
            }
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn-ghost cap-search-clear" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {error && <div className="cap-error">{error}</div>}

      {loading ? (
        <div className="cap-state">
          <OrbLoader state="searching" size={64} />
        </div>
      ) : tab === "skills" ? (
        <div className="cap-master-detail">
          <div className="cap-list">
            {filteredSkills.length === 0 ? (
              <div className="cap-empty">{t("capabilities.noSkills")}</div>
            ) : (
              filteredSkills.map((skill) => (
                <div
                  key={skill.name}
                  className={`cap-row ${detailSkill?.name === skill.name ? "active" : ""}`}
                  onClick={() => void openSkillDetail(skill)}
                >
                  <div className="cap-row-main">
                    <div className="cap-row-title">{skill.name}</div>
                    <div className="cap-row-sub">
                      {skill.category}
                      <span className="cap-provenance">{t(`capabilities.provenance.${skill.provenance}`) ?? skill.provenance}</span>
                      {skill.usage > 0 && (
                        <span className="cap-usage">×{skill.usage}</span>
                      )}
                    </div>
                  </div>
                  <label className="cap-toggle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      disabled={skillBusy === skill.name}
                      onChange={() => void handleToggleSkill(skill)}
                    />
                    <span className="cap-toggle-track" />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="cap-detail">
            {detailSkill ? (
              <div className="cap-detail-inner">
                <div className="cap-detail-title">{detailSkill.name}</div>
                <div className="cap-detail-meta">
                  <span className="cap-pill">{detailSkill.category}</span>
                  <span className="cap-pill cap-pill--muted">
                    {t(`capabilities.provenance.${detailSkill.provenance}`) ?? detailSkill.provenance}
                  </span>
                </div>
                <p className="cap-detail-desc">{detailSkill.description}</p>
                <div className="cap-detail-content">
                  {skillContent ? (
                    <AgentMarkdown>{skillContent}</AgentMarkdown>
                  ) : (
                    <div className="cap-empty">{t("capabilities.emptyState")}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="cap-detail-empty">{t("capabilities.skillDetail")}</div>
            )}
          </div>
        </div>
      ) : tab === "toolsets" ? (
        <div className="cap-master-detail">
          <div className="cap-list">
            {filteredToolsets.length === 0 ? (
              <div className="cap-empty">{t("capabilities.noToolsets")}</div>
            ) : (
              filteredToolsets.map((toolset) => (
                <div
                  key={toolset.name}
                  className={`cap-row ${detailToolset?.name === toolset.name ? "active" : ""}`}
                  onClick={() => setDetailToolset(toolset)}
                >
                  <div className="cap-row-main">
                    <div className="cap-row-title">{toolset.label}</div>
                    <div className="cap-row-sub">
                      {toolset.description}
                      {!toolset.configured && (
                        <span className="cap-pill cap-pill--warn">{t("capabilities.needsKeys")}</span>
                      )}
                    </div>
                  </div>
                  <label className="cap-toggle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={toolset.enabled}
                      disabled={toolsetBusy === toolset.name}
                      onChange={() => void handleToggleToolset(toolset)}
                    />
                    <span className="cap-toggle-track" />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="cap-detail">
            {detailToolset ? (
              <div className="cap-detail-inner">
                <div className="cap-detail-title">{detailToolset.label}</div>
                <p className="cap-detail-desc">{detailToolset.description}</p>
                <div className="cap-tool-chips">
                  {detailToolset.tools.map((tool) => (
                    <span key={tool} className="cap-tool-chip">{tool}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="cap-detail-empty">{t("capabilities.toolsetDetail")}</div>
            )}
          </div>
        </div>
      ) : tab === "mcp" ? (
        <div className="cap-empty">{t("capabilities.tabs.mcp")}</div>
      ) : (
        <div className="cap-empty">{t("capabilities.tabs.hub")}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the CSS**

Append to `src/renderer/src/assets/main.css`:

```css
/* ---- Capabilities screen ---- */
.cap-container { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 20px 24px; gap: 14px; }
.cap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cap-title { font-size: 20px; font-weight: 700; margin: 0; }
.cap-subtitle { font-size: 13px; color: var(--text-secondary, #8b93a7); margin: 2px 0 0; }
.cap-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border, #2a2f3a); padding-bottom: 8px; }
.cap-tab { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--text-secondary, #8b93a7); font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
.cap-tab:hover { background: var(--bg-hover, rgba(255,255,255,0.06)); }
.cap-tab.active { color: var(--text-primary, #e6e9ef); background: var(--bg-active, rgba(255,255,255,0.1)); }
.cap-tab-count { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg-tertiary, #232834); color: var(--text-tertiary, #6b7280); }
.cap-search { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; background: var(--bg-secondary, #1a1e27); border: 1px solid var(--border, #2a2f3a); color: var(--text-tertiary, #6b7280); }
.cap-search-input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary, #e6e9ef); font-size: 13px; }
.cap-search-clear { color: var(--text-tertiary, #6b7280); }
.cap-error { padding: 8px 12px; border-radius: 8px; background: rgba(239, 68, 68, 0.12); color: #f87171; font-size: 12px; }
.cap-state { flex: 1; display: grid; place-items: center; }
.cap-empty { color: var(--text-tertiary, #6b7280); font-size: 13px; padding: 24px; text-align: center; }
.cap-master-detail { display: flex; flex: 1; min-height: 0; border: 1px solid var(--border, #2a2f3a); border-radius: 12px; overflow: hidden; }
.cap-list { flex: 0 0 320px; overflow-y: auto; border-right: 1px solid var(--border, #2a2f3a); }
.cap-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04)); }
.cap-row:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
.cap-row.active { background: var(--bg-active, rgba(255,255,255,0.08)); }
.cap-row-main { min-width: 0; }
.cap-row-title { font-size: 13px; font-weight: 600; color: var(--text-primary, #e6e9ef); }
.cap-row-sub { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-tertiary, #6b7280); margin-top: 2px; flex-wrap: wrap; }
.cap-provenance { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; background: var(--bg-tertiary, #232834); }
.cap-usage { font-size: 11px; color: var(--text-tertiary, #6b7280); }
.cap-toggle { position: relative; display: inline-flex; flex-shrink: 0; }
.cap-toggle input { opacity: 0; position: absolute; inset: 0; cursor: pointer; }
.cap-toggle-track { width: 34px; height: 18px; border-radius: 999px; background: var(--bg-tertiary, #2a2f3a); transition: background 0.15s; }
.cap-toggle input:checked + .cap-toggle-track { background: #3b82f6; }
.cap-toggle-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
.cap-toggle input:checked + .cap-toggle-track::after { transform: translateX(16px); }
.cap-toggle input:disabled + .cap-toggle-track { opacity: 0.5; }
.cap-detail { flex: 1; overflow-y: auto; padding: 16px 20px; }
.cap-detail-empty { color: var(--text-tertiary, #6b7280); font-size: 13px; }
.cap-detail-inner { display: flex; flex-direction: column; gap: 10px; }
.cap-detail-title { font-size: 16px; font-weight: 700; }
.cap-detail-meta { display: flex; gap: 6px; }
.cap-pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg-tertiary, #232834); color: var(--text-secondary, #8b93a7); }
.cap-pill--muted { opacity: 0.7; }
.cap-pill--warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.cap-detail-desc { font-size: 13px; color: var(--text-secondary, #8b93a7); margin: 0; }
.cap-detail-content { font-size: 13px; max-width: 640px; }
.cap-tool-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cap-tool-chip { font-size: 11px; font-family: ui-monospace, monospace; padding: 3px 8px; border-radius: 6px; background: var(--bg-tertiary, #232834); }
.cap-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; }
.cap-badge--builtin { background: var(--bg-tertiary, #232834); color: var(--text-secondary, #8b93a7); }
.cap-badge--trusted { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.cap-badge--community { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/screens/Capabilities/Capabilities.tsx src/renderer/src/screens/Capabilities/Capabilities.test.tsx src/shared/i18n/locales/en/capabilities.ts src/renderer/src/assets/main.css
git commit -m "feat(ui): Capabilities screen — Skills + Toolsets master-detail tabs"
```

---

### Task 6: Capabilities screen (part 2 — MCP tab)

**Files:**
- Modify: `src/renderer/src/screens/Capabilities/Capabilities.tsx`
- Modify: `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`:

```tsx
const MOCK_MCP = [
  {
    name: "github",
    type: "http" as const,
    transport: "http" as const,
    enabled: true,
    detail: "https://example.com/mcp",
    url: "https://example.com/mcp",
    args: [],
    env: {},
  },
];

describe("Capabilities — MCP tab", () => {
  it("renders the MCP server table from listMcpServers", async () => {
    const view = mountWith({ listMcpServers: vi.fn().mockResolvedValue(MOCK_MCP) });
    await waitFor(() => expect(view.getByText("capabilities.title")).toBeTruthy());
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[2] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("github")).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: FAIL — MCP tab shows "MCP" empty text, no server row

- [ ] **Step 3: Port the MCP table into the MCP tab**

Copy the MCP-management code from the old `src/renderer/src/screens/Tools/Tools.tsx` into Capabilities.tsx:
- The `McpServer` interface, `AddMcpForm` + `EMPTY_ADD_FORM`, `parseArgsText`, `parseEnvText`, `formToInput`, `formToJson`, `parseServerJson`, `IconButton`, `TinyIcon`, `McpLogo` components (lines 81-309 of Tools.tsx)
- The MCP state (`mcpServers`, `mcpError`, `mcpMessage`, `mcpBusy`, `showAddMcp`, `addForm`, `editingMcpName`, `mcpEditMode`, `mcpJsonText`, `mcpJsonError`, `editingEnabled`, `mcpSearch`)
- The `loadMcp` function and all MCP handlers (`openAddMcp`, `openEditMcp`, `closeMcpModal`, `switchMcpMode`, `handleSaveMcp`, `handleRemoveMcp`, `handleMcpEnabled`, `handleTestMcp`)
- Replace the old `tab === "mcp"` branch with the ported table JSX (the `.mcp-table`, `.mcp-row`, `.mcp-thead` markup and the add/edit modal from Tools.tsx lines 683-862 and 866-1082)

Key integration points:
- Load MCP servers alongside skills/toolsets in `load()`: `const [s, ts, mcp] = await Promise.all([getDashboardSkills, getDashboardToolsets, listMcpServers])`
- The modal uses `.models-modal-overlay`/`.models-modal` classes — keep them (still present in main.css)
- Keep `visible` refetch behavior: add `listMcpServers` to the visible-refetch effect

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Capabilities/Capabilities.tsx src/renderer/src/screens/Capabilities/Capabilities.test.tsx
git commit -m "feat(ui): Capabilities MCP tab — port server table + editor from Tools"
```

---

### Task 7: Capabilities screen (part 3 — Hub tab)

**Files:**
- Modify: `src/renderer/src/screens/Capabilities/Capabilities.tsx`
- Modify: `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/screens/Capabilities/Capabilities.test.tsx`:

```tsx
describe("Capabilities — Hub tab", () => {
  it("shows source chips and featured skills from getHubSources", async () => {
    const view = mountWith();
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[3] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("Official")).toBeTruthy());
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
  });

  it("searches via searchHubSkills with the debounced query", async () => {
    const search = vi.fn().mockResolvedValue({
      results: [
        {
          name: "ocr",
          identifier: "skills-sh/x/ocr",
          source: "skills.sh",
          trustLevel: "community",
          description: "OCR skill",
        },
      ],
      installed: {},
      timedOut: [],
    });
    const view = mountWith({ searchHubSkills: search });
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[3] as HTMLButtonElement);
    });
    const input = view.container.querySelector(".cap-search-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "ocr" } });
    });
    await waitFor(() => expect(search).toHaveBeenCalledWith("ocr", "all", 20, "default"), { timeout: 2000 });
    await waitFor(() => expect(view.getByText("OCR skill")).toBeTruthy());
  });

  it("opens the preview dialog and shows the SKILL.md content", async () => {
    const preview = vi.fn().mockResolvedValue({
      name: "pdf",
      description: "Create PDFs",
      source: "official",
      identifier: "official/productivity/pdf",
      trustLevel: "trusted",
      skillMd: "# PDF\nCreate and edit.",
      files: ["SKILL.md"],
    });
    const view = mountWith({ previewHubSkill: preview });
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[3] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const previewBtns = view.container.querySelectorAll(".cap-hub-preview-btn");
    await act(async () => {
      fireEvent.click(previewBtns[0] as HTMLButtonElement);
    });
    await waitFor(() => expect(preview).toHaveBeenCalledWith("official/productivity/pdf", "default"));
    await waitFor(() => expect(view.getByText(/Create and edit/)).toBeTruthy());
  });

  it("scans a skill from the preview dialog", async () => {
    const scan = vi.fn().mockResolvedValue({
      name: "pdf",
      identifier: "i",
      trustLevel: "trusted",
      verdict: "caution",
      summary: "",
      policy: "ask",
      policyReason: "review",
      findings: [{ severity: "high", category: "network", file: "x.sh", line: 3, description: "curl" }],
      severityCounts: { critical: 0, high: 1, medium: 0, low: 0 },
    });
    const view = mountWith({ scanHubSkill: scan });
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[3] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const previewBtns = view.container.querySelectorAll(".cap-hub-preview-btn");
    await act(async () => {
      fireEvent.click(previewBtns[0] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("Scan")).toBeTruthy());
    const scanBtn = view.container.querySelector(".cap-hub-scan-btn") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(scanBtn);
    });
    await waitFor(() => expect(scan).toHaveBeenCalledWith("official/productivity/pdf", "default"));
    await waitFor(() => expect(view.getByText(/curl/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: FAIL — Hub tab shows empty placeholder

- [ ] **Step 3: Implement the Hub tab**

In `Capabilities.tsx`, extend the React import to include `useRef`, then add the hub state and logic:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// --- Hub state ---
const [hubSources, setHubSources] = useState<HubSourcesResult | null>(null);
const [hubResults, setHubResults] = useState<HubSkill[]>([]);
const [hubInstalled, setHubInstalled] = useState<Record<string, { name: string }>>({});
const [hubSearching, setHubSearching] = useState(false);
const [hubPreview, setHubPreview] = useState<HubPreview | null>(null);
const [hubScan, setHubScan] = useState<HubScan | null>(null);
const [hubScanning, setHubScanning] = useState(false);
const [hubBusy, setHubBusy] = useState<string | null>(null);
const [updatingAll, setUpdatingAll] = useState(false);
const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Load hub sources once on mount (in `load()` add `getHubSources` to the Promise.all):

```tsx
const [s, ts, mcp, hub] = await Promise.all([
  window.hermesAPI.getDashboardSkills(profile),
  window.hermesAPI.getDashboardToolsets(profile),
  window.hermesAPI.listMcpServers(profile),
  window.hermesAPI.getHubSources(profile).catch(() => null),
]);
```

Debounced search effect:

```tsx
useEffect(() => {
  if (tab !== "hub") return;
  const q = query.trim();
  if (searchTimer.current) clearTimeout(searchTimer.current);
  if (!q) {
    setHubResults([]);
    setHubSearching(false);
    return;
  }
  setHubSearching(true);
  searchTimer.current = setTimeout(() => {
    void window.hermesAPI
      .searchHubSkills(q, "all", 20, profile)
      .then((data) => {
        setHubResults(data.results);
        setHubInstalled(data.installed);
        setHubSearching(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setHubSearching(false);
      });
  }, 350);
  return () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  };
}, [tab, query, profile]);
```

Hub actions:

```tsx
const openHubPreview = useCallback(
  async (skill: HubSkill): Promise<void> => {
    setHubPreview(null);
    setHubScan(null);
    const data = await window.hermesAPI.previewHubSkill(skill.identifier, profile);
    setHubPreview(data);
  },
  [profile],
);

const runHubScan = useCallback(
  async (identifier: string): Promise<void> => {
    setHubScanning(true);
    try {
      setHubScan(await window.hermesAPI.scanHubSkill(identifier, profile));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHubScanning(false);
    }
  },
  [profile],
);

const handleHubInstall = useCallback(
  async (identifier: string): Promise<void> => {
    setHubBusy(identifier);
    try {
      const res = await window.hermesAPI.installHubSkill(identifier, profile);
      if (!res.success && res.error) setError(res.error);
      else {
        setHubInstalled((prev) => ({ ...prev, [identifier]: { name: identifier } }));
        setHubPreview(null);
        void load();
      }
    } finally {
      setHubBusy(null);
    }
  },
  [profile, load],
);

const handleHubUninstall = useCallback(
  async (name: string, identifier: string): Promise<void> => {
    setHubBusy(identifier);
    try {
      const res = await window.hermesAPI.uninstallHubSkill(name, profile);
      if (!res.success && res.error) setError(res.error);
      else {
        const next = { ...hubInstalled };
        delete next[identifier];
        setHubInstalled(next);
        void load();
      }
    } finally {
      setHubBusy(null);
    }
  },
  [profile, hubInstalled, load],
);

const handleUpdateAll = useCallback(async (): Promise<void> => {
  setUpdatingAll(true);
  try {
    const res = await window.hermesAPI.updateHubSkills(profile);
    if (!res.success && res.error) setError(res.error);
  } finally {
    setUpdatingAll(false);
  }
}, [profile]);
```

Replace the `tab === "hub"` placeholder branch with the hub UI (source chips, featured/search results, preview dialog). The dialog reuses `.models-modal-overlay`/`.models-modal` classes:

```tsx
) : tab === "hub" ? (
  <div className="cap-hub">
    <div className="cap-hub-sources">
      <span className="cap-hub-sources-label">{t("capabilities.hubSources")}</span>
      <div className="cap-hub-chips">
        {(hubSources?.sources ?? []).map((source) => {
          const degraded = source.available === false || source.rateLimited === true;
          return (
            <span
              key={source.id}
              className={`cap-hub-chip ${degraded ? "cap-hub-chip--degraded" : ""}`}
            >
              {source.label}
            </span>
          );
        })}
      </div>
    </div>

    <div className="cap-hub-toolbar">
      <span className="cap-hub-count">
        {query.trim()
          ? t("capabilities.resultCount", { count: hubResults.length })
          : t("capabilities.featured")}
        {hubSearching && <span className="cap-hub-searching"> {t("capabilities.searching")}</span>}
      </span>
      {Object.keys(hubInstalled).length > 0 && (
        <button
          className="btn-ghost btn-sm"
          disabled={updatingAll}
          onClick={() => void handleUpdateAll()}
        >
          {updatingAll ? t("capabilities.updating") : t("capabilities.updateAll")}
        </button>
      )}
    </div>

    <div className="cap-hub-list">
      {hubSearching ? (
        <div className="cap-state"><OrbLoader state="searching" size={48} /></div>
      ) : (
        (query.trim() ? hubResults : hubSources?.featured ?? []).map((skill) => {
          const installed = Boolean(hubInstalled[skill.identifier]);
          const busy = hubBusy === skill.identifier;
          return (
            <div key={skill.identifier} className="cap-hub-row">
              <div className="cap-hub-row-main">
                <div className="cap-hub-row-title">
                  <span className="cap-hub-name">{skill.name}</span>
                  <span className={trustTone(skill.trustLevel)}>
                    {t(`capabilities.trust.${skill.trustLevel}`) ?? skill.trustLevel}
                  </span>
                  {installed && <span className="cap-hub-installed">{t("capabilities.installed")}</span>}
                </div>
                <p className="cap-hub-desc">{skill.description}</p>
              </div>
              <div className="cap-hub-row-actions">
                <button
                  className="btn-ghost btn-sm cap-hub-preview-btn"
                  onClick={() => void openHubPreview(skill)}
                >
                  {t("capabilities.preview")}
                </button>
                {installed ? (
                  <button
                    className="btn-ghost btn-sm cap-hub-uninstall-btn"
                    disabled={busy}
                    onClick={() => void handleHubUninstall(hubInstalled[skill.identifier].name, skill.identifier)}
                  >
                    {busy ? t("capabilities.uninstalling") : t("capabilities.uninstall")}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => void handleHubInstall(skill.identifier)}
                  >
                    {busy ? t("capabilities.installing") : t("capabilities.install")}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
      {!hubSearching &&
        (query.trim() ? hubResults.length === 0 : (hubSources?.featured ?? []).length === 0) && (
          <div className="cap-empty">
            {query.trim() ? t("capabilities.noHubResults") : t("capabilities.hubLanding")}
          </div>
        )}
    </div>

    {hubPreview && (
      <div className="models-modal-overlay" onClick={() => setHubPreview(null)}>
        <div className="models-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="models-modal-header">
            <div className="cap-hub-preview-title">
              <span className="cap-hub-name">{hubPreview.name}</span>
              <span className={trustTone(hubPreview.trustLevel)}>
                {t(`capabilities.trust.${hubPreview.trustLevel}`) ?? hubPreview.trustLevel}
              </span>
            </div>
            <button
              className="btn-ghost"
              onClick={() => setHubPreview(null)}
              aria-label={t("capabilities.close") ?? "Close"}
            >
              <X size={18} />
            </button>
          </div>
          <div className="models-modal-body">
            <p className="cap-hub-preview-identifier">{hubPreview.identifier}</p>
            {hubPreview.description && <p className="cap-detail-desc">{hubPreview.description}</p>}

            {hubScan && (
              <div className="cap-hub-scan">
                <div className={`cap-hub-scan-verdict cap-hub-scan-verdict--${hubScan.verdict}`}>
                  {t(`capabilities.verdict.${hubScan.verdict}`) ?? hubScan.verdict}
                  {" · "}
                  {t(`capabilities.policy.${hubScan.policy}`) ?? hubScan.policy}
                </div>
                <div className="cap-hub-scan-findings">
                  {hubScan.findings.length === 0
                    ? t("capabilities.noFindings")
                    : hubScan.findings.map((f, i) => (
                        <div key={i} className="cap-hub-scan-finding">
                          [{f.severity}] {f.file}
                          {f.line !== null ? `:${f.line}` : ""} — {f.description}
                        </div>
                      ))}
                </div>
              </div>
            )}

            {hubPreview.skillMd ? (
              <pre className="cap-hub-preview-md">{hubPreview.skillMd}</pre>
            ) : (
              <div className="cap-empty">{t("capabilities.noReadme")}</div>
            )}
            {hubPreview.files.length > 0 && (
              <div className="cap-hub-preview-files">
                {t("capabilities.files")}: {hubPreview.files.join(", ")}
              </div>
            )}
          </div>
          <div className="models-modal-footer">
            <button
              className="btn btn-secondary btn-sm cap-hub-scan-btn"
              disabled={hubScanning}
              onClick={() => void runHubScan(hubPreview.identifier)}
            >
              {hubScanning ? t("capabilities.scanning") : t("capabilities.scan")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={Boolean(hubInstalled[hubPreview.identifier]) || hubBusy === hubPreview.identifier}
              onClick={() => void handleHubInstall(hubPreview.identifier)}
            >
              {hubInstalled[hubPreview.identifier]
                ? t("capabilities.installed")
                : hubBusy === hubPreview.identifier
                  ? t("capabilities.installing")
                  : t("capabilities.install")}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
```

Add the hub CSS to main.css:

```css
/* ---- Capabilities hub ---- */
.cap-hub { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 10px; }
.cap-hub-sources { font-size: 11px; color: var(--text-tertiary, #6b7280); }
.cap-hub-sources-label { display: block; margin-bottom: 6px; }
.cap-hub-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cap-hub-chip { font-size: 10px; padding: 3px 8px; border-radius: 999px; background: var(--bg-tertiary, #232834); color: var(--text-secondary, #8b93a7); }
.cap-hub-chip--degraded { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.cap-hub-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--text-tertiary, #6b7280); }
.cap-hub-searching { color: var(--text-quaternary, #4b5563); }
.cap-hub-list { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border, #2a2f3a); border-radius: 12px; }
.cap-hub-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04)); }
.cap-hub-row:last-child { border-bottom: none; }
.cap-hub-row-main { min-width: 0; flex: 1; }
.cap-hub-row-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cap-hub-name { font-size: 13px; font-weight: 600; color: var(--text-primary, #e6e9ef); }
.cap-hub-installed { font-size: 10px; color: #34d399; }
.cap-hub-desc { font-size: 12px; color: var(--text-tertiary, #6b7280); margin: 3px 0 0; }
.cap-hub-row-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.cap-hub-preview-title { display: flex; align-items: center; gap: 8px; }
.cap-hub-preview-identifier { font-size: 11px; color: var(--text-tertiary, #6b7280); font-family: ui-monospace, monospace; margin: 0; }
.cap-hub-preview-md { font-size: 12px; font-family: ui-monospace, monospace; max-height: 320px; overflow: auto; padding: 10px 12px; border-radius: 8px; background: var(--bg-secondary, #1a1e27); border: 1px solid var(--border, #2a2f3a); white-space: pre-wrap; }
.cap-hub-preview-files { font-size: 11px; color: var(--text-tertiary, #6b7280); }
.cap-hub-scan { padding: 10px 12px; border-radius: 8px; background: var(--bg-tertiary, #232834); border: 1px solid var(--border, #2a2f3a); font-size: 12px; }
.cap-hub-scan-verdict { font-weight: 600; }
.cap-hub-scan-verdict--safe { color: #34d399; }
.cap-hub-scan-verdict--caution { color: #fbbf24; }
.cap-hub-scan-verdict--dangerous { color: #f87171; }
.cap-hub-scan-findings { margin-top: 4px; color: var(--text-secondary, #8b93a7); }
.cap-hub-scan-finding { font-family: ui-monospace, monospace; font-size: 11px; margin-top: 4px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Capabilities/Capabilities.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Capabilities/Capabilities.tsx src/renderer/src/screens/Capabilities/Capabilities.test.tsx src/renderer/src/assets/main.css
git commit -m "feat(ui): Capabilities Hub tab — sources, search, preview, scan, install"
```

---

### Task 8: Wire Layout — replace Discover/Tools/Skills with Capabilities

**Files:**
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`

- [ ] **Step 1: Update the View type and nav**

In `src/renderer/src/screens/Layout/Layout.tsx`:

1. Add `"capabilities"` to the `View` union (line 67-82). Keep `"discover"`, `"tools"`, `"skills"` in the union only if other code still references them; the goal is to remove them. Search the file for other `view === "discover"` / `view === "tools"` / `view === "skills"` usages (e.g. run targets, keyboard shortcuts) and update them.

2. Replace the nav entries:
   - Remove `{ view: "discover", icon: Compass, labelKey: "navigation.discover" }` from `PINNED_NAV_ITEMS` (line 85)
   - Remove `{ view: "tools", icon: Workflow, labelKey: "navigation.tools" }` from `FOOTER_NAV_ITEMS` (line 96)
   - Remove `"skills"` from `VIEW_LABEL_KEYS` if unused elsewhere; add `capabilities: "navigation.tools"` (which is "Capabilities")
   - Decide the Capabilities placement: replace the Discover entry in PINNED with `{ view: "capabilities", icon: Compass, labelKey: "navigation.tools" }` — keep it in the same visual spot.

3. Update `focusDiscover` (lines 551-557) to `focusCapabilities`:

```tsx
const focusCapabilities = useCallback(
  (tab: CapabilityTab) => {
    setDiscoverFocus((prev) => ({ tab, nonce: (prev?.nonce ?? 0) + 1 }));
    goTo("capabilities");
  },
  [goTo],
);
```

Import `CapabilityTab` from `../Capabilities/Capabilities`.

4. Update the pane rendering (lines 1300-1378): delete the `discover`, `skills`, and `tools` panes; add:

```tsx
{visitedViews.has("capabilities") && (
  <div style={paneStyle("capabilities")}>
    <Capabilities
      profile={activeProfile}
      visible={view === "capabilities"}
      focusTab={discoverFocus ?? undefined}
    />
  </div>
)}
```

5. Update callers of `focusDiscover`:
   - Any `onBrowseSkills={() => focusDiscover("skills")}` / `onBrowseMcps={() => focusDiscover("mcps")}` props no longer exist (Tools is deleted) — remove them.
   - Search the file for other places dispatching `"navigation:goto"` with `"discover"`/`"skills"`/`"tools"` (e.g. from Chat "Browse skills" actions or welcome screen) and retarget to `"capabilities"` or the new tab focus.

- [ ] **Step 2: Verify no dangling imports**

Delete the imports of `Discover`, `Skills`, `Tools` from Layout.tsx (lines 23, 28, 30) and add `import Capabilities from "../Capabilities/Capabilities";`

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors

- [ ] **Step 4: Run renderer tests**

Run: `npx vitest run src/renderer/src`
Expected: PASS except the pre-existing known failures

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Layout/Layout.tsx
git commit -m "feat(ui): mount Capabilities as the single capabilities view; drop Discover/Tools/Skills views"
```

---

### Task 9: Delete old screens + their CSS

**Files:**
- Delete: `src/renderer/src/screens/Discover/Discover.tsx`
- Delete: `src/renderer/src/screens/Tools/Tools.tsx`
- Delete: `src/renderer/src/screens/Skills/Skills.tsx`
- Delete: `src/renderer/src/screens/Skills/Skills.test.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Delete the screen files**

```bash
git rm src/renderer/src/screens/Discover/Discover.tsx
git rm src/renderer/src/screens/Tools/Tools.tsx
git rm src/renderer/src/screens/Skills/Skills.tsx
git rm src/renderer/src/screens/Skills/Skills.test.tsx
```

Check for other test files referencing these screens: `rg -l "screens/Discover|screens/Tools|screens/Skills" src --glob "*.test.ts*"` and delete/port them.

- [ ] **Step 2: Remove obsolete CSS**

In `src/renderer/src/assets/main.css`, delete the `.discover-*`, `.skills-*` block styles that belonged to the deleted screens. Keep `.mcp-table`, `.mcp-row`, `.mcp-thead`, `.tools-toggle`, `.tools-icon-btn`, `.models-modal*` (the MCP table + editor moved into Capabilities still uses them).

Run: `rg -n "discover-|skills-card|skills-tab|skills-grid|skills-pill|skills-detail" src/renderer/src/assets/main.css` and remove those rule blocks.

- [ ] **Step 3: Verify no dangling references**

```bash
rg -rn "screens/Discover|screens/Tools|screens/Skills" src
rg -rn "from \"./Discover\"|from \"../Discover\"|from \"./Tools\"|from \"../Tools\"|from \"./Skills\"|from \"../Skills\"" src/renderer/src
```
Expected: no matches (Layout already updated in Task 8).

- [ ] **Step 4: Run the full renderer test suite**

Run: `npx vitest run src/renderer/src`
Expected: PASS except pre-existing known failures (useDashboardChatTransport, dashboard-event-adapter)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A && git reset HEAD tmp/
git commit -m "chore(ui): delete Discover/Tools/Skills screens and their CSS"
```

---

### Task 10: Update lat.md docs + final verification

**Files:**
- Modify: `lat.md/` (create/update capability-screen docs)
- Modify: (docs) `docs/superpowers/specs/2026-08-07-capabilities-redesign-design.md` — mark implemented

- [ ] **Step 1: Update lat.md**

Add/update a section documenting the Capabilities screen (e.g. `lat.md/ui/capabilities.md` or the existing screen docs) covering: the four tabs, the dashboard REST endpoints used (`GET /api/skills`, `PUT /api/skills/toggle`, `GET /api/tools/toolsets`, `PUT /api/tools/toolsets/{name}`, `/api/skills/hub/*`), the CLI wrappers (`hermes skills install/uninstall/update`), and the trust/provenance model. Follow the lat.md section rules (leading paragraph ≤250 chars, wiki links `[[...]]`, code refs `// @lat: [[section]]` where applicable).

- [ ] **Step 2: Run lat validation manually**

`lat` CLI is not installed — validate by hand: check that all `[[wiki-links]]` point to existing sections, all code refs point to real functions (e.g. `[[src/main/dashboard-capabilities.ts#getDashboardSkills]]`), and every section has a leading paragraph.

- [ ] **Step 3: Full test + typecheck run**

Run: `npm run typecheck && npx vitest run`
Expected: all green except the two known pre-existing failures (useDashboardChatTransport "creates a clean runtime after a failed provider turn", dashboard-event-adapter "preserves reasoning, tool, and assistant output sequence") and env-flaky suites (terminal-launcher, cronjobs, ssh-remote, gateway-restart).

- [ ] **Step 4: Manual smoke test**

Start the app (`npm run dev`), verify:
1. Sidebar shows one "Capabilities" entry (Compass icon in the pinned section).
2. Skills tab lists the installed skills (66 bundled) with category + provenance + toggle; toggling a skill writes `skills.disabled` to `%LOCALAPPDATA%\hermes\config.yaml`.
3. Toolsets tab lists toolsets with toggles; toggling updates `platform_toolsets.cli`.
4. MCP tab shows the server table; add/edit/test/remove flows work.
5. Hub tab shows connected-hub chips, featured skills, search returns results (e.g. "ocr"), preview shows SKILL.md, scan returns verdict, install/uninstall/update-all work.
6. Sidebar Discover/Tools/Skills entries are gone.

- [ ] **Step 5: Commit**

```bash
git add lat.md/ docs/superpowers/specs/2026-08-07-capabilities-redesign-design.md
git commit -m "docs: capabilities screen docs + mark design spec implemented"
git push fork custom
```

---

## Self-Review Notes

- Spec coverage: all spec sections map to tasks — backend wiring (Tasks 2-3), IPC/preload (Task 4), renderer screen (Tasks 5-7), Layout replacement (Task 8), deletion (Task 9), i18n/tests/docs (Tasks 5, 10). Deferred v2 items (learned-skill edit/archive, usage-analytics sort, paginated browse) are intentionally absent.
- Placeholders: all steps contain concrete code. Task 8 is intentionally more descriptive (Layout edits are surgical and location-dependent) but lists the exact lines and edits.
- Type consistency: `HubSkill`/`HubSourcesResult`/`HubPreview`/`HubScan` names and fields are defined once in Task 1 and reused verbatim in Tasks 2, 4, 7. `installHubSkill`/`uninstallHubSkill`/`updateHubSkills` defined in Task 3, used in Tasks 4 and 7. `CapabilityTab` defined in Task 5, used in Task 8.
