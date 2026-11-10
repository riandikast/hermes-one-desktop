# Capabilities screen

The Capabilities screen is the single master-detail surface for the agent's skills, toolsets, plugins, MCP servers, and the skill hub — one screen with five tabs, replacing the former Discover/Tools/Skills views.

[[src/renderer/src/screens/Capabilities/Capabilities.tsx#Capabilities]] renders a header (title/subtitle/refresh), a five-tab bar (Skills | Toolsets | Plugins | MCP | Hub) with counts, and a shared debounced search input (hidden on the MCP tab). Data comes from the `hermes dashboard` backend REST API plus the `hermes` CLI for hub mutations; the screen is mounted by [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] as the "Capabilities" sidebar entry (`navigation.tools` label).

## Dashboard REST client

The main process talks to the already-running dashboard backend the chat transport uses — no extra process.

[[src/main/dashboard.ts#dashboardRequestJson]] is the generic authenticated helper (method/body aware, `X-Hermes-Session-Token` header, timeout) and [[src/main/dashboard.ts#getDashboardConnection]] resolves the active profile's managed dashboard base URL + token. Reads use a 30s timeout: cold first calls are slow (measured ~12s for `GET /api/tools/toolsets` on a fresh backend — lazy imports + the skills scan) and the backend event loop can stall while an agent turn streams. [[src/main/dashboard-capabilities.ts#getDashboardSkills]] / [[src/main/dashboard-capabilities.ts#getDashboardToolsets]] / [[src/main/dashboard-capabilities.ts#getHubSources]] / [[src/main/dashboard-capabilities.ts#searchHubSkills]] / [[src/main/dashboard-capabilities.ts#previewHubSkill]] / [[src/main/dashboard-capabilities.ts#scanHubSkill]] wrap the backend routes (`GET /api/skills`, `GET /api/tools/toolsets`, `GET /api/skills/hub/*`); toggles go through [[src/main/dashboard-capabilities.ts#setDashboardSkillEnabled]] (`PUT /api/skills/toggle`, writes `skills.disabled` in config.yaml) and [[src/main/dashboard-capabilities.ts#setDashboardToolsetEnabled]] (`PUT /api/tools/toolsets/{name}`, writes `platform_toolsets.cli`). If no dashboard is running, `ensureDashboardConnection` starts one via [[src/main/dashboard.ts#startDashboard]] (which waits for readiness) so the screen works standalone. In remote/SSH mode the same functions route through `remoteDashboardRequestJson` so they read and mutate the REMOTE machine's config, never the local one. The renderer fetches each source independently (a failing endpoint errors inline without blanking the tabs that loaded).

## Skill hub

The Hub tab searches and installs from the 90k+ skill hub (skills.sh, official Hermes, GitHub, ClawHub, …) exactly like the official desktop.

[[src/main/dashboard-capabilities.ts#getHubSources]] fetches the connected-source chips + featured list + installed map; [[src/main/dashboard-capabilities.ts#searchHubSkills]] runs the debounced search (deduped by identifier, higher trust wins, `timedOut` sources reported). [[src/main/dashboard-capabilities.ts#previewHubSkill]] shows the SKILL.md without installing and [[src/main/dashboard-capabilities.ts#scanHubSkill]] runs the install-time security scan (verdict/policy/findings). Mutations reuse the CLI wrappers [[src/main/skills.ts#installHubSkill]] (`hermes skills install <id> --yes`), [[src/main/skills.ts#uninstallHubSkill]], and [[src/main/skills.ts#updateHubSkills]] (`hermes skills update`) — the backend itself spawns the CLI for these. Trust levels (builtin/trusted/community) drive the badge tones via `trustTone`.

## Payload parsing

All hub payloads are normalized by pure parsers in [[src/shared/capabilities.ts#parseHubSkill]] / [[src/shared/capabilities.ts#parseHubSources]] / [[src/shared/capabilities.ts#parseHubPreview]] / [[src/shared/capabilities.ts#parseHubScan]] so the renderer only ever sees the typed `HubSkill` / `HubSourcesResult` / `HubPreview` / `HubScan` shapes (snake_case from the backend mapped to camelCase, missing fields defaulted).

## Plugins tab

The Plugins tab mirrors the official desktop's Capabilities → Plugins subpage for the agent half: installed plugins with version, source, server state, tool count and update pins, plus enable/disable, per-row Update, Update all and Remove.

Rows for user installs can be removed; bundled ones cannot.

Plugin state is not on the dashboard HTTP surface, so [[src/main/dashboard-rpc.ts#dashboardRpc]] opens a short-lived authenticated WebSocket (`/api/ws?token=…`) and sends one JSON-RPC 2.0 frame — the same channel the chat transport uses. [[src/main/dashboard-plugins.ts#listDashboardPlugins]] calls `plugins.manage {action:"list"}`; writes go through [[src/main/dashboard-plugins.ts#manageDashboardPlugin]], which allow-lists `toggle`, `update`, `update_all` and `remove` (install/inspect flows stay in the CLI and official desktop). [[src/shared/plugins.ts#parseDashboardPlugins]] maps the snake_case rows, derives user/bundled counts when the gateway omits them and keeps missing arrays empty.

The renderer loads the list lazily on first visit, re-reads it after every write instead of patching optimistically, and keeps the last list on screen when a request fails so the error surfaces without an empty table. Bundled plugins never show Remove; rows whose status is not `enabled` render dimmed with the toggle off.

## MCP tab

The MCP tab is the former Tools screen's server table moved in as-is: servers with transport badges, search, add/edit/test/remove, enable toggles, and the visual/JSON editor modal ([[src/renderer/src/screens/Capabilities/Capabilities.tsx#formToInput]] / [[src/renderer/src/screens/Capabilities/Capabilities.tsx#parseServerJson]] helpers). See [[mcp-servers]] for the underlying IPC surface.
