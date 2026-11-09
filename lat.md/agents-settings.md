# Agents and notification settings

Settings gains two official-desktop sections: **Agents** (the Model › Subagents and Model › Mixtures of Agents subpages) and **Notifications** (alerts and sounds).

## Agents › Subagents

[[src/renderer/src/components/settings/AgentsPane.tsx]] renders the delegation knobs the backend exposes — `delegation.provider`, `delegation.model`, `delegation.reasoning_effort`, `max_iterations`, `max_concurrent_children`, `child_timeout_seconds`, `max_spawn_depth`, `oneshot_max_children` — as one row per key with its own Save.

Each Save writes exactly one key through the config IPC and verifies the read-back before reporting success, matching the Advanced/Memory panes. Provider and model are blank-by-default because an empty value means "inherit the main agent's model and credentials". Numbers are validated against the backend's floors (iterations ≥ 1, concurrency ≥ 1, timeout ≥ 0, depth ≥ 1) before any write.

Not ported: the official routing backends (model maps, profile routes, the Advanced Delegation plugin). Those stay in the official desktop and the CLI; the pane says so rather than showing dead controls.

## Agents › Mixture of Agents

MoA lives in the dashboard, not in flat config keys: `GET/PUT /api/model/moa` carries presets, each with reference slots, an aggregator, temperatures, a timeout and a degraded-reference policy.

[[src/main/model-extras.ts#getMoaConfig]] / [[src/main/model-extras.ts#saveMoaConfig]] proxy those calls (direct Remote, the local/SSH dashboard otherwise) and normalize the payload. The pane edits the selected preset — preset picker, enable switch, ordered reference models with add/remove, aggregator, temperatures, timeout, loud/silent degradation — and writes the whole document back, the same read-modify-write the official client performs.

`Save` is blocked until every reference slot and the aggregator carry a provider and a model: the backend rejects incomplete presets with 422 instead of silently replacing them with defaults, so a half-filled editor must not submit.

## Fallback Models

The fallback chain is the top-level `fallback_providers` list in config.yaml — the same list the agent reads. [[src/renderer/src/components/FallbackModelsSection.tsx]] places the editor on the Providers page under **Default model**: ordered rows of provider + model, move up/down, remove, add, Save.

[[src/main/config.ts#parseYamlObjectList]] reads the block list back (the scalar-only `getYamlPath` cannot), so the editor shows exactly what is stored — including keys it does not edit. Those keys (`base_url`, `key_env`, `api_mode`, …) ride along on save, so a local-gateway chain is never rewritten into bare provider/model pairs and re-routed to a public endpoint.

Save writes JSON through the existing object-list writer (real YAML mappings), then re-reads the chain and compares provider/model order; a write the backend would drop can therefore never look saved. Incomplete rows block Save instead of being silently dropped.

### Alignment with the picker chain

The chat model picker also keeps an ordered fallback list. It used to be local-only, published to `fallback_providers` only after a failed turn, which let the two lists disagree.

[[src/renderer/src/screens/Chat/fallbackModels.ts#saveFallbackModels]] now publishes to config on every edit, and [[src/renderer/src/screens/Chat/fallbackModels.ts#refreshFallbackModelsFromConfig]] adopts the configured chain (config wins once it has entries; a non-empty local list is migrated up when config is empty). The dashboard transport refreshes before computing the chain for a send, so a chain edited on the Providers page wins the next failed turn.

The dialog stays in step while it is open: the picker refreshes whenever it opens, and the Providers editor broadcasts `fallback-models:config-changed` after a verified save so an already-mounted picker re-reads the file instead of showing the previous chain.

Routing keys the picker does not edit (`key_env`, `api_mode`, …) survive the round trip: [[src/renderer/src/screens/Chat/fallbackModels.ts#refreshFallbackModelsFromConfig]] keeps them in the entry's `extra` bag and the publisher re-emits them under the edited provider/model. Without that, one picker edit would strip a hand-written local-gateway chain down to bare provider/model pairs.

## Notifications

[[src/renderer/src/components/settings/NotificationsPane.tsx]] mirrors the official Alerts/Sounds split with what this shell actually owns:

- Desktop notifications (master), Turn finished, Turn failed — persisted by the main process in `userData/notifications.json` and enforced in [[src/main/desktop-notifications.ts#showDesktopNotification]], the only place that raises an OS notification.
- Finish chime — the in-app tone from the chat completion path, gated by the same prefs.
- Send test — reports whether the OS accepted the notification instead of claiming success.

The switches are device-local (never config.yaml) and save immediately; the pane broadcasts `notification-prefs:changed` so an open chat applies a sound change without a restart.
