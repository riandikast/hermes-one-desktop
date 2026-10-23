# Session model override

The in-chat (bottom) model picker selects a model for the **current conversation only** — it never rewrites `config.yaml`, so the Settings global default is preserved (#688), and carries the full model identity so cross-provider switches route correctly.

The override is held in renderer state on each `<Chat>` run ([[src/renderer/src/screens/Chat/Chat.tsx]]), persisted by session id, and sent with every message; it is cleared when the conversation is cleared/reset and is absent on a fresh chat, so new conversations start on the global default. This is distinct from the persisted [[model-context]] default that non-chat surfaces read.

## Two-pane picker grouped by display brand

The bottom [[src/renderer/src/screens/Chat/ModelPicker.tsx]] dropdown is a two-pane layout: a left **provider rail** filters a right **flat model list**, with a top search box (leading magnifier icon) narrowing both.

The panel is styled as a floating native surface — translucent glass (`backdrop-filter`) lifted on a soft ambient shadow rather than a hard border, a recessed search field, and a filled-tint selection instead of an outlined row — so it reads as a desktop popover, not a web form. Depth comes from light (elevation, highlight, inset), not strokes; all radii use `var(--radius-*)` so the squared-corners theme toggle is respected.

The rail has an "All models" entry plus one row per brand (logo + model count); each list row shows the model title, a `Provider · model-id` subtitle, and a check on the active model. The currently-selected model is sorted **first** within whatever filter is shown (exact provider+model+baseUrl match, then same provider+model), leaving the rest of the list in its original order.

Models are grouped by **display brand**, not the raw stored provider, so OpenAI-compatible providers persisted as `custom` (Hermes One, Groq, DeepSeek, …) get their own rail entry instead of one generic "OpenAI Compatible / Local" bucket. [[src/renderer/src/screens/Chat/hooks/useModelConfig.ts#groupModelsByProvider]] derives each group's key/label from [[src/renderer/src/constants.ts#displayBrandFromConfig]], which reverse-maps a `custom` model's `baseUrl` to a brand id via `OPENAI_COMPATIBLE_BASE_URLS` (same reverse-map the [[provider-setup]] active-model picker uses). A `custom` endpoint not in the map stays under "OpenAI Compatible / Local".

Crucially, each model row keeps its **raw** `provider`/`baseUrl` for selection — only the rail grouping/label is branded — so routing and the active-model check (`currentModel === m.model && currentProvider === m.provider`) are unchanged. The rail brand filter is display-only React state; picking "All models" or a brand never rewrites config. The rail logo is the brand's [[src/renderer/src/components/common/BrandLogo.tsx]] (`matchTheme`), with a generic fallback for unknown brands.

A **Configure** button is pinned at the bottom of the provider rail (below the scrollable brand list), replacing the old free-text model input: it closes the picker and dispatches the `navigation:goto` window event (detail `"providers"`) that [[src/renderer/src/screens/Layout/Layout.tsx]] listens for, taking the user to the Providers screen to manage keys and the model library.

## Full identity, not just the model name

The override is a `SessionModelOverride` (`{provider, model, baseUrl}`), not a bare model string — because switching across providers must change routing, not only the `model` field.

The picker builds it via [[src/renderer/src/screens/Chat/hooks/useModelConfig.ts#effectiveOverrideBaseUrl]], the same baseUrl rule `selectModel` applies (keep the URL only for `custom`/`ollama-cloud`; clear it for named providers that have a canonical base URL), so the session pick and a persisted save can't drift. It is threaded renderer → preload IPC → main `sendMessage` as `modelOverride`.

## Desktop-only persistence

The selected model/provider is saved in a desktop-owned table keyed by session id, without storing API keys.

[[src/main/session-model-override-store.ts]] holds `desktop_session_model_overrides` with `provider`, `model`, and `base_url` only. [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] restores the saved value for a resumed session, applies it to the local picker with `persist:false`, and saves later changes once a gateway session id exists. Deleting a session removes the row through [[src/main/sessions.ts#deleteSessionRows]].

## Text-only legacy fallback routes via CLI

Text-only legacy turns can use the CLI fallback when a session override changes provider or base URL away from `config.yaml`.

The dashboard transport applies the session switch with `config.set` (`key:model`, `value:<model> --provider <provider> --session`), verifies `session.status`, then attaches media and submits on that session; [[src/main/hermes.ts#shouldForceCliForSessionOverride]] keeps the CLI escape hatch only for text-only legacy fallback, where it can pass `-m <model>` and `--provider` without dropping attachments. Same-provider model swaps stay on the gateway/API path, where the new `model` string is sufficient. Remote (SSH) mode has no local CLI transport, so it remains limited to the model string.

## Attachment turns stay on session transport

Attachment turns must not be forced through the CLI override fallback because the CLI path cannot carry multimodal input.

[[src/main/hermes.ts#sendMessageViaCli]] can inline text-file attachments but ignores images, while the gateway/API path preserves image parts and path refs through [[src/main/hermes.ts#buildUserContent]]. When a session override is active and the user sends attachments, [[src/main/hermes.ts#shouldForceCliForSessionOverride]] leaves the turn eligible for the dashboard/gateway or API transport instead of silently dropping media.

## Non-blocking switch validation

The dashboard transport requires live `session.status` identity to match before submission; stale catalog selection or isolated slash-worker success cannot override it.

`config.set` mutates the live session with explicit provider and `--session`; existing catalog resolution preserves custom-provider/baseURL mapping. A `confirm_required` result repeats the identical call once with `confirm_expensive_model:true`, honoring the previously authorized pick. A second confirmation, deferred result, unsupported/malformed response, missing status, or contradictory live identity fails visibly without a prompt. No `/approve`, worker retry, or healthy-session reset is used.

## Ordinary manual switch architecture probe

The offline regression probe separates isolated slash-worker output from the live agent's model; worker success is not proof that the next prompt uses that model.

[[src/renderer/src/screens/Chat/hooks/modelSelection.integration.test.tsx]] executes the real Chat selection callback and transport after a completed first prompt. `scripts/probe-manual-model-switch.py` extracts installed backend definitions without importing server/config, accessing user state, or calling providers. It executes the real model mirror, `_apply_model_switch` decision, context-cache guard, installed `_set_model` config handler, and non-fallback turn-start restore; provider resolution and successful commit mechanics remain fixtures.

Before the fix, the 99,999-token control passed while the 100,000-token case submitted on `primary` despite worker success. Both now pass through the live config setter, including its one confirmation round-trip. This proves a bounded architectural defect, not that the user's actual session crossed that threshold. The mirror discards `confirm_required`; its direct return creates no pending confirmation for `/approve`. A renderer success regex then outweighs contradictory `session.status`. The regression checks runtime at prompt submission, not just the picker; negative fixtures cover unsupported setters, repeated confirmation, missing/contradictory status, malformed replies, and timeout.

Run `npm test -- src/renderer/src/screens/Chat/hooks/modelSelection.integration.test.tsx -t 'ordinary pick' --maxWorkers=1`. The backend source root defaults to the installed checkout and can be passed explicitly to the Python probe. This is not a full server or paid provider integration.

## Serialized switch queue with a bounded application

Model applications are serialized so an older `config.set` cannot land after a newer pick, but each queued entry is bounded and only a newer selection supersedes it.

`modelApplicationRef` in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] chains `config.set` applications. Two rules keep the ordering from becoming a trap:

- **Supersession is per selection, not per send.** `modelSelectionEpochRef` increments on each explicit pick. A queued application is skipped only when a newer selection exists — never because the user pressed Stop or recovery bumped the send generation. Conflating the two cancelled the user's own pending switch on interrupt, so the picker moved while the backend kept the previous model.
- **Every entry has a ceiling.** `MODEL_SWITCH_BUDGET` bounds each config call (20s) and the application (45s). Expiry prevents late async continuations from starting a mutation or validating success. There is no recursive timeout re-apply; failure is visible and a later explicit pick/send can retry.

The control socket used for a switch is tracked in `modelControlClientsRef` so the ceiling can release it. Interrupt deliberately does *not* close it: closing only rejects the renderer promise while the gateway still executes the switch, which let a stale model land after the new pick. A selection the backend does not confirm now surfaces through `onModelApplyError` instead of silently leaving the old model running. Regression: [[src/renderer/src/screens/Chat/hooks/modelSwitchUnwedge.test.tsx]].

## Named provider versus runtime billing class

Named custom providers resolve to runtime provider `custom`; status lacks endpoint identity, so matching the model alone cannot safely validate a named-provider switch.

`scripts/probe-named-provider-identity.py` replays installed resolver, setter and status definitions with fixture-only endpoints. Exact `9r` / `oc/mimo-v2.6-flash-free` pins `9r` but displays `custom` after construction. The same model on a different custom endpoint produces identical status. `config.set` acknowledges model and scope, not the live endpoint. Inventory canonical identity may fall back to model ownership or profile config, so it is not independent endpoint proof. Production validation remains fail-closed pending a live session-owned endpoint/route identity contract; no named-to-custom blanket equivalence is accepted. Safety controls: [[src/renderer/src/screens/Chat/hooks/namedProviderIdentity.test.ts]].

## Fresh runtime readiness

Fresh sessions return before agent construction; model selection waits for custom endpoint inventory and live identity rather than trusting a pre-build acknowledgement.

Installed session.create schedules construction after returning. Explicit-provider config.set can pin model_override without an agent; status then reports Model: (unknown) (unknown). Custom discovery is non-blocking. Selection refreshes unresolved endpoint inventory up to 20 times at 250 ms, then selects once and polls placeholder live status with the same bound. Existing generation, epoch, and application ceiling guards remain active. Missing/contradictory status fails closed; no prompt is retried. The offline scripts/probe-fresh-model-readiness.py replays installed definitions without importing the server or reading user state.
