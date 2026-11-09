# Advanced and Memory settings

Hermes One exposes profile-scoped Advanced and Memory & Context controls using the existing settings modal and config IPC, without changing chat transport or restarting sessions.

## Upstream reference

Parity is pinned to installed official desktop commit `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`; the installed checkout and user configuration are read-only references.

The official sources are `apps/desktop/src/app/settings/constants.ts`, `config-subpages.ts`, `config-settings.tsx`, `config-field.tsx`, memory provider panels, and the corresponding `hermes_cli/config_defaults.py` and `web_server_config.py`.

## Controls and persistence

[[src/shared/agent-settings.ts#MEMORY_SETTINGS]] and [[src/shared/agent-settings.ts#ADVANCED_SETTINGS]] contain the curated upstream config controls, grouped like official subpages, plus the existing compression token ceiling.

Memory includes built-in memory/user injection, character limits, discovered external provider selection, context engine, auto-compression, threshold, Codex auto-raise, target ratio, protected messages and auxiliary timeout. Advanced includes toolsets, terminal backend/timeout/images, output limits, checkpoint count, iterations, API retry attempts, service tier, tool-use enforcement and update local-change policy. Singularity image is a legacy setting absent from current upstream defaults but retained in its curated keys.

[[src/renderer/src/components/settings/AgentConfigPane.tsx#AgentConfigPane]] uses existing Hermes One theme classes and localization with English fallbacks. `/settings advanced` and `/settings memory` open the panes. Each explicit Save writes only one selected-profile key and verifies read-back. Defaults never auto-save. Confirmations protect clearing toolsets and selecting destructive update discard mode.

[[src/main/config.ts#setConfigValue]] uses [[src/shared/agent-settings.ts#agentSettingsScalar]] to preserve real YAML booleans, numbers, nulls and model-name lists, rather than quoted strings. Only the curated auxiliary timeout gets missing three-level section creation. Unsupported inline sections fail instead of appending duplicate keys.

### Subpages as tabs

Tabs come from [[src/shared/agent-settings.ts#SETTINGS_TABS]]: Memory & Context shows `Memory` and `Context`, Advanced shows `Desktop`, `Runtime`, `Tools`, `Terminal` and `Output`.

The official desktop splits each section into subpages. Hermes One renders the same split as a segmented tab strip above one `settings-group`, so only the active subpage's rows exist in the DOM.

Tabs reuse the Appearance pane's `settings-seg` styling and the shared `.settings-row` layout — label and hint on the left, control and Save on the right — instead of stacking every group heading, which previously repeated a row label such as "Persistent memory". Switching tabs never discards unsaved edits because values live in the pane, not the tab panel.

### Keep Awake

[[src/shared/keep-awake.ts#KEEP_AWAKE_MODES]] mirrors the official modes — `off`, `while-working` (default) and `always` — and [[src/main/keep-awake.ts#initKeepAwake]] owns the single native `prevent-app-suspension` blocker so the display may still dim.

The mode is device-local in `userData/keep-awake.json`, restored at launch before any window exists; [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] reports the live turn picture through `setKeepAwakeWorking`, so `while-working` never pins an idle machine. Counts keep two windows from releasing the blocker early.

## Scope and remaining parity gaps

Agent controls are intentionally local-only: the existing remote/SSH generic config bridge is not safe for native typed writes. Desktop F12 uses the existing verified shortcut API and preserves every other DevTools chord.

Changing agent settings affects new sessions; no automatic gateway restart, current-session policy rewrite or backend modification occurs. Settings carry the supplied profile through every config read/write. Actual connection mode is checked before loading and again before saving.

Official Quick Entry/global shortcut, rerun onboarding, live memory-provider readiness/OAuth/schema-specific configuration are not implemented in this bounded port. Hermes One already opens ordinary markdown links in the system browser, so no duplicate Always External Links switch is added. Provider installation/credentials remain on the existing Memory page; provider selection never claims readiness. Non-English labels use existing English fallback pending translations.

## Regression coverage

Focused settings and existing YAML/config regression suites verify persistence and navigation. Typecheck, production compilation and scoped lint pass; live desktop interaction remains unverified, with no gateway restart or user configuration edits.

### Settings navigation

Nav tests open both new destinations by slash-command initial section and nav label while retaining the existing Providers doorway and nav order.

### Profile persistence

Pane tests check defaults without writes, dynamic provider discovery, retained undiscovered selections and single-field verified writes with the supplied profile.

Tab tests assert both tab strips render the official subpage names and that switching to `Context` unmounts the Memory rows while keeping no duplicated `Persistent memory` heading anywhere in the pane.

### Validation and failed verification

Invalid numbers and missing read-back never report success. Failed loads expose Reload; destructive toolset/update choices require confirmation.

### Connection isolation

Remote and SSH panes never read or write local agent configuration. Main-process tests cover typed scalars, missing auxiliary timeout nesting and sibling preservation.
