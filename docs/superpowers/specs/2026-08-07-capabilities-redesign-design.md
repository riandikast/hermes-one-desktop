# Capabilities Screen Redesign — Official-Style Master-Detail

Date: 2026-08-07

> **Status: IMPLEMENTED** (2026-08-07, commits 7f58e8b..d506bab on `custom`).
> Implementation plan: `docs/superpowers/plans/2026-08-07-capabilities-redesign.md`.

## Goal

Redesign the fork's Discover screen into a single "Capabilities" screen that matches
the official Hermes desktop's skills page (apps/desktop/src/app/skills/ in
NousResearch/hermes-agent): a master-detail layout with four tabs — Skills, Toolsets,
MCP, Hub — powered by the official CLI/backend that the fork already spawns.

## Context

- Fork base: community version (fathah/hermes-desktop). Engine: official CLI installed
  at `%LOCALAPPDATA%\hermes` (full git checkout + venv at `hermes-agent/`, 66 bundled
  skills in 13 categories).
- The official desktop is Electron and spawns `hermes serve`/`hermes dashboard` once;
  the renderer talks REST (`GET /api/skills`, `PUT /api/skills/toggle`, ...) and WebSocket.
  Our fork already spawns `hermes dashboard --no-open` (src/main/hermes.ts) with a
  session token and uses JSON-RPC over WS for chat. The REST endpoints are served by
  the same backend.
- Official CLI verified working locally:
  - `hermes skills search <q> --json` → `[{name, identifier, source, trust_level, description}]`
  - `hermes skills inspect <id>` → SKILL.md preview (table output, parse the preview region)
  - `hermes skills browse` — NO `--json`; table only → unusable for a clean catalog.
  - `hermes skills install/uninstall --yes` — already wrapped in src/main/skills.ts
    (with failure-marker classification, issue #310).
- Our current `searchSkills` (src/main/skills.ts) uses a dead flag (`browse --query
  --json` — removed from modern CLI); it is replaced.
- Backend REST contract (hermes_cli/web_routers/):
  - `GET /api/skills` → flat array, each skill `{name, enabled, usage, provenance
    (bundled|hub|agent), category, description, ...}`
  - `PUT /api/skills/toggle` `{name, enabled}` → writes `skills.disabled` in config.yaml
  - `GET /api/tools/toolsets` → `{name, label, description, platform, enabled,
    available, configured, tools}`
  - `PUT /api/tools/toolsets/{name}` `{enabled}` → writes `platform_toolsets.<platform>`
  - Hub install/uninstall/update on the backend spawn the CLI (matches our approach).

## Decisions (user-approved)

1. Layout: master-detail rows (not cards).
2. Tabs: official set — Skills | Toolsets | MCP | Hub (drop Agents/Workflows).
3. Hub data: official CLI hub (90k+ skills, skills.sh/official/github/... sources).
4. The redesigned screen REPLACES the standalone Tools and Skills screens; they are
   deleted (files, CSS, tests).
5. Skills-tab enable toggle: wire to dashboard backend REST (`PUT /api/skills/toggle`).
6. Hub tab is search-first (no paginated browse — browse lacks --json).
7. Deferred to v2: hub security scan (findings/verdict — no CLI scan flag), learned-skill
   edit/archive dialogs, usage-analytics caching (365-day scan).

## Architecture

### 1. Backend wiring (src/main/)

The dashboard backend our fork already spawns (`hermes dashboard`, src/main/hermes.ts,
with session token + port) serves the full REST contract the official desktop uses
(hermes_cli/web_routers/skills.py, tools.py). Extend `src/main/hermes.ts` (or a new
`src/main/dashboard-skills.ts` reusing its client) with authenticated calls:

- `GET /api/skills` — flat array: `{name, enabled, usage, provenance (bundled|hub|agent),
  category, description, ...}` (feeds Skills tab)
- `PUT /api/skills/toggle` `{name, enabled}` — writes `skills.disabled` in config.yaml
- `GET /api/tools/toolsets` — `{name, label, description, platform, enabled, available,
  configured, tools}` (feeds Toolsets tab)
- `PUT /api/tools/toolsets/{name}` `{enabled}` — writes `platform_toolsets.<platform>`
- `GET /api/skills/hub/sources` — `{sources: [{id, label, available, rate_limited,
  searchable}], index_available, featured: SkillMeta[12], installed: {identifier: {name}}}
  — feeds Hub tab chips + featured landing
- `GET /api/skills/hub/search?q=&source=&limit=` — parallel source search, deduped by
  identifier preferring higher trust, `{results: SkillMeta[], source_counts,
  timed_out, installed}` — hub search
- `GET /api/skills/hub/preview?identifier=` — `{name, description, source, identifier,
  trust_level, repo, tags, skill_md, files}` — preview dialog
- `GET /api/skills/hub/scan?identifier=` — `{name, identifier, source, trust_level,
  verdict (safe|dangerous|caution), summary, policy (allow|ask|block), policy_reason,
  findings: [{severity, category, file, line, description}], severity_counts}` —
  on-demand security scan in the preview dialog

SkillMeta = `{name, identifier, source, trust_level (builtin|trusted|community),
description}`.

CLI wrappers (new `src/main/skills-hub.ts`, execFileSync pattern like
installSkill/uninstallSkill) handle the mutating hub ops — the backend itself spawns
the CLI for these (web_routers/skills.py lines 60-107), so we match official behavior:

- `installHubSkill(identifier)` → reuse `installSkill` (`hermes skills install <id> --yes`)
- `uninstallHubSkill(name)` → reuse `uninstallSkill`
- `updateHubSkills(): SkillCliResult` → `hermes skills update [name]` (no --yes flag;
  classify via existing classifySkillCliOutput)

If the dashboard backend is unreachable: toolsets fall back to the current CLI/disk
paths (getToolsets/setToolsetEnabled in src/main/tools.ts); skills list falls back to
listInstalledSkills; skill enable toggle degrades to disabled with an error toast; hub
search/preview degrade to an offline state with retry.

Remove dead `searchSkills` from src/main/skills.ts (uses removed `browse --query --json`).

### 2. IPC / preload

Add to src/main/ipc/register.ts + src/preload/index.ts + index.d.ts:

- `getDashboardSkills()`
- `setDashboardSkillEnabled(name, enabled)`
- `getDashboardToolsets()`
- `setDashboardToolsetEnabled(name, enabled)`
- `getHubSources()`
- `searchHubSkills(query, source?, limit?)`
- `previewHubSkill(identifier)`
- `scanHubSkill(identifier)`
- `updateHubSkills()`
- `installHubSkill(identifier)` (thin wrapper over existing installSkill)
- `uninstallHubSkill(name)` (thin wrapper over existing uninstallSkill)

Existing handlers stay: listInstalledSkills, listBundledSkills, getSkillContent,
installSkill, uninstallSkill, listMcpServers + MCP CRUD, getToolsets, setToolsetEnabled.

### 3. Renderer — src/renderer/src/screens/Capabilities/Capabilities.tsx

Structure (mirrors official skills/index.tsx where sensible, in our existing CSS/token
system):

- Header: title + subtitle + refresh button.
- Tabs bar (shared search input, hidden on MCP):
  - Skills (count = installed skills)
  - Toolsets (count = visible toolsets)
  - MCP (no count; existing table)
  - Hub (no count)
- Skills tab — master-detail:
  - Left column: row per installed skill — name, category subtitle, provenance badge
    (bundled/hub/learned), enable toggle (dashboard REST, optimistic + revert on
    error), usage ×N badge when available.
  - Right column: detail pane — description, category + provenance pills, SKILL.md
    content (getSkillContent), Uninstall action.
- Toolsets tab — master-detail:
  - Left: rows — label, description, enable toggle (optimistic), tool-count meta.
  - Right: detail — description, tool chips, "needs keys" warning when !configured.
- MCP tab: the existing MCP table UI moved in as-is (servers, transport badge,
  add/edit/test/remove, enable toggles, search, footer).
- Hub tab (search-first, official style):
  - Source chips row (`GET /api/skills/hub/sources`: official, skills.sh, github, ...;
    degraded tint when unavailable/rate-limited, dimmed while searching).
  - Featured landing (sources endpoint returns `featured`, ~12 skills) when the query
    is empty; debounced search (350ms) → `searchHubSkills`; stale-term abandonment;
    progressive fill.
  - Result rows: name, trust badge (builtin/trusted/community in official tones),
    installed checkmark (from `installed` map), description, Preview / Install /
    Uninstall.
  - Preview dialog (`previewHubSkill`): identifier, description, trust badge, SKILL.md
    content, file list, "Scan" button (`scanHubSkill` — verdict/policy badge,
    severity counts, findings list), Install button.
  - "Update all" button when any hub skill is installed (`updateHubSkills`).
- Loading/empty/error states consistent with the rest of the app (OrbLoader, existing
  empty-state classes).

Delete: src/renderer/src/screens/Discover/Discover.tsx (+ test), Tools/Tools.tsx,
Skills/Skills.tsx (+ test) and their CSS. Preserve the reusable pieces: MCP table
markup/logic (moved into Capabilities), McpLogo, ToolIcon, TinyIcon, RemoteNotice usage,
focusDiscover navigation.

### 4. Layout.tsx

- One sidebar entry "Capabilities" replaces Discover/Tools/Skills entries.
- `focusDiscover(kind, nonce)` becomes `focusCapabilities(kind, nonce)` — sets the tab
  (skills | toolsets | mcp | hub) on the Capabilities screen.
- Remote (SSH) mode: keep RemoteNotice behavior on the screen.

### 5. i18n

New `capabilities.*` keys (en at minimum; port any reused strings from discover./tools./
skills.): title, subtitle, tabs (skills/toolsets/mcp/hub), search placeholders, trust
labels, provenance labels, actions (install/uninstall/update all/preview), states.

### 6. Tests

- Main: dashboard-client tests (URLs, payloads, token header, error fallback),
  skills-hub CLI tests (update classification via classifySkillCliOutput), hub REST
  payload parsers (search/sources/preview/scan shape, malformed input).
- Renderer: Capabilities.test.tsx — tabs render, Skills rows + toggle optimistic
  flow, Toolsets toggle, Hub search flow (mocked IPC), featured landing, preview
  dialog + scan, install action; MCP tab preserved behavior.
- Delete old Discover/Tools/Skills tests; port any still-valuable assertions.

## Error handling

- Hub CLI failures: classifySkillCliOutput markers (No exact match / No skill named /
  Error:) → toast + inline error.
- Dashboard REST unreachable: toggle disabled with toast; toolsets/skills fall back to
  CLI/disk sources; hub tabs show offline state with retry.
- Search: empty results → official-style "nothing matches" empty state; search error →
  degraded state with retry; `timed_out` sources reported via chip tint.

## Testing

- Targeted vitest suites for new modules + Capabilities screen.
- Full `npm run test` (main + renderer) green except known pre-existing failures
  (useDashboardChatTransport "creates a clean runtime after a failed provider turn",
  dashboard-event-adapter "preserves reasoning, tool, and assistant output sequence",
  env-flaky ssh-remote/gateway suites).
- Manual: run the app, switch through all 4 tabs, hub featured landing + search,
  preview + scan + install/uninstall a hub skill, update all, toggle a skill and
  verify config.yaml skills.disabled changes, toggle a toolset, MCP add/edit/test/
  remove, verify sidebar shows one Capabilities entry.

## Out of scope (v2)

- Learned-skill edit/archive dialogs (REST `GET/PUT /api/learning/node` exists — defer).
- Usage-analytics caching + most-used sort menu (365-day scan is heavy).
- Paginated browse of the full hub catalog.
