# Reasoning effort control

The composer selects reasoning for one chat, never the profile. Its slider offers Auto, Off, minimal, low, medium, high, xhigh, max and ultra; provider support still determines the actual wire level.

Settings → Providers also stores a **default thinking** tier for chats that have no pick of their own. It is renderer-only (`hermes.reasoning.default`, no `agent.reasoning_effort` config write and no backend change); the composer always wins for that chat, and an existing per-chat pick is never overwritten when the default changes.

[[src/renderer/src/screens/Chat/ReasoningEffortPicker.tsx#ReasoningEffortPicker]] renders it. Medium is labeled Standard; xhigh is Extra high, distinct from max. Manual tiers are Hermes requests, not promises that every provider supports each wire level.

## Session storage and transport

Selections are keyed by profile and durable session id, or by the unique run id for a new draft. Migration preserves a draft pick; reopening restores it without writing profile config.

[[src/renderer/src/screens/Chat/hooks/useReasoningEffort.ts#useReasoningEffort]] never calls getConfig/setConfig.

Its read path falls back to [[src/renderer/src/components/settings/defaultReasoning.ts#readDefaultReasoning]] only when the chat's own key has no stored value, so the default seeds drafts while stored picks stay authoritative. The Providers select is [[src/renderer/src/screens/Providers/Providers.tsx#Providers]]'s Default thinking section; tiers come from [[src/renderer/src/screens/Chat/reasoningTiers.ts]] so the picker and the setting cannot disagree. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#applyDashboardReasoning]] applies `config.set` with `key: reasoning`, explicit `scope: session` and the live runtime session id before `prompt.submit`, including a recovered id. It requires the returned value to match and blocks submission on rejection. Auto leaves an untouched runtime alone; after a manual pick it restores that connection's captured prior value. Legacy HTTP cannot apply these session RPCs, so a manual selection blocks legacy sending rather than silently using global effort.

## Official tier vocabulary

Official Hermes exposes seven enabled tiers plus Off. The old fork exposed five enabled tiers and mislabeled xhigh as Max.

Evidence: upstream commit `4ea8d23cc9f527332ccb1d55359b27741b6ea51b`, `apps/shared/src/reasoning-effort.ts`, and installed `hermes_constants.py` define minimal/low/medium/high/xhigh/max/ultra. Upstream `agent/reasoning_effort.py` clamps to the route's vocabulary: ultra is normally an internal tier, not a literal provider wire value. Codex app-server can accept ultra when its model supports max. No provider request is constructed by this renderer. Configuration reference: https://hermes-agent.nousresearch.com/docs/user-guide/configuration.

## Session isolation verification

The focused regression exercises independent drafts, draft-to-stored migration, remount restoration and actual ordered dashboard RPC payloads, including a second chat with no mutation.

The default-thinking setting is covered separately: the hook starts an unclaimed chat at the stored default while an explicit per-chat pick survives a later default change, and the transport sends that default as session-scoped `config.set` before the first `prompt.submit`. The Providers select writes only renderer storage — it must never call `setConfig`, `setModelConfig` or `setAuxiliaryTask`.

The actual send-hook test checks session-scoped max application before prompt submission. The network boundary is simulated; no paid provider request, installed backend edit or user database mutation is required.

## Slider interaction

The panel is a single `role="slider"` track, not a list of options — the six stops are non-focusable visual dots, and the track owns all input.

Pointer drag: pressing anywhere on the track and moving maps the pointer x to the nearest stop and applies it live (the rail spans the first/last dot centres, 9px in from each track edge; `indexFromClientX` does the math). Keyboard: the focused track handles ←/→ plus ↑/↓, Home, and End. Every path funnels through `commit(index)`, which clamps to range, dedupes against the last-applied index (a ref kept in sync with the selected value), and calls `select` — so a drag fires **one** `onChange` per real level change, not one per pixel, and the click that follows a pointer release is a no-op. The `--effort-frac` custom property (selectedIndex / (n−1)) drives the accent rail-fill and knob position in CSS.

## Stays open until dismissed

Choosing a level no longer closes the popover, so the user can nudge the level several times in a row without it vanishing.

`select` only awaits `onChange` and clears or sets the save-error flag; it never toggles `isOpen`. Dismissal is explicit: a `mousedown` outside `pickerRef`, or Escape (which the slider's key handler ignores so it bubbles to the dropdown's `onKeyDown`). A failed save keeps the panel open with an inline error and restores the prior selection.
