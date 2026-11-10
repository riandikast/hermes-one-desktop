# Hermes One — Journey Summary

**Window:** 24 October → 9 November 2026 · **Version range:** 0.7.27 → 0.7.62 · **Branch:** `custom` (fork of `fathah/hermes-desktop`)

A record of what we built in this fork, why, and where it stands. Commit hashes are real; test counts are from the runs recorded against them.

---

## 1. Starting point

Hermes One is a **desktop shell for the Hermes agent**, not a second agent: Electron main process, React renderer, and a live WebSocket connection to the installed `hermes-agent` backend (`python -m hermes_cli.main gateway run`). Almost everything in this window is *renderer and shell work*: the backend owns models, tools, sessions and config; the shell owns how you see and drive them.

That split shaped every decision below. When a feature could live in the backend, we let the backend own the truth (config.yaml, `state.db`, the gateway RPC surface) and made the shell reflect it — rather than growing a second, divergent copy of state.

---

## 2. By the numbers

| | |
|---|---|
| Non-merge commits (window) | **156** |
| Releases cut | **36** (0.7.27 → 0.7.62) |
| Files changed (window) | **362** (+35,521 / −3,899) |
| Source today | **1,015** TS/TSX files, **210,034** lines |
| Test files today | **287** |
| `lat.md` sections | **317** across **52** files |

Every commit in this window passed the gates below before landing; nothing was pushed without confirmation.

---

## 3. Timeline

### Phase 1 — Foundations: runtime, updater, on-finish (24–26 Oct)

The shell had to stop guessing about the backend it was talking to.

- **Runtime discovery & recovery** — safe startup provenance (`e6cc6eb`, `24fd995`), recovery from a verified managed Python when the Windows launcher was missing (`e7cecfd`), and recovery *before* model validation so a missing runtime no longer surfaced as a bogus model error (`065e056`).
- **Updater honesty** — honor real update availability and reconcile typed chat bubbles against the DB (`305a59b`).
- **On-finish automation** — a keyboard banner plus a speed-dial FAB (`3d4ce79`), compact editor (`d7ff716`), automatic commands into existing terminals (`b8ca9f2`), waiting for settled child work before firing (`8e29ffc`), order badges (`c77d5d5`).
- **Context** — native auto-compaction settings (`3d3ac3d`), compact UI with a 1M-token fallback (`572427d`), and local context occupancy shown before the provider answers (`283dd94`).
- **Providers** — separated provider settings tabs from auxiliary routing (`88c46c3`), flattened section surfaces (`342e9bb`).
- **Knowledge** — portable package transfer with toast status (`56ae541`, `1a5bb12`), and an envelope fix so ordinary prompts aren't duplicated into wire context (`c6621a2`).

### Phase 2 — Mention and file plumbing (27–29 Oct)

- Mention rows show **file and folder modification times** (`2931562`) — a small change that made the picker genuinely useful for choosing between similarly named files.
- Explorer bounded to rows with pagination (`6c957f6`), copied history stripped of a leading BOM (`852267f`).
- A full renderer typecheck/test repair pass, tagged `[verified]` (`3f0b4c5`).

### Phase 3 — Source Control, built out (30–31 Oct)

This was the largest single block: Source Control went from "a list of changed files" to a working Git client.

- **Staging & actions** — simpler action model with resizable output (`b3fd265`), refined file menus and graph layout (`e4349b2`), ignore controls and search (`4f275bb`, `50530fe`), refined tooltips and shift-selection (`57fa4fa`).
- **History graph** — commit context menu with revert (`42a7457`), dismissal on scroll (`b4b39ee`), UTC date-range filtering with Apply (`723db01`, `b6dffd7`).
- **Branches** — local branch management and ignored-path sorting (`2d96a21`), rename unpublished HEAD with resize (`f55e329`), upstreams and remote names (`a930bd3`), remote URLs with in-app confirm to fix Windows focus loss (`a46cc06`), remote management inside the branch dialog (`700567e`).
- **Stashes** — selected-file stashing (`17f860e`), individual stashed files (`e2bcdc7`), independent refresh preserving submodules (`4b2685a`), stash internals kept out of the commit graph (`948cc8c`), folder stash paths plus section toggles (`4365353`).
- **Repo lifecycle** — initialize repositories from the empty state (`16de735`).
- **Terminals** — owned terminals, resizable panes, accessible splitters (`38f0f44`), non-destructive show/hide, and toggling source terminals on tab entry (`ca6d5bd`).

### Phase 4 — Chat transcript truth (1–3 Nov)

The recurring theme: **what the transcript says must match what actually happened.**

- File-change history with side-by-side diffs (`7f10f2d`), aligned disclosures (`bca03ba`), expandable history and decoded live prompts (`47a7d15`).
- **Cumulative per-prompt summaries** (`6e69d34`) — the chip now reports everything a prompt changed, not just the last tool call.
- Theme-token fixes so dialogs, tabs, badges, search and the floating rail all follow the palette (`4ed8ac1`, `6f5cca1`, `7492012`, `daa3506`).
- **Keyboard shortcuts pane** (`188f315`), per-action chord editing that no longer drops sibling shortcuts (`97208ad`), and removal of individual chords (`8429e7e`).
- **Per-file autosave** with a Utils default (`22705da`) and a pinned fold-gutter contract (`4d5eaf6`).
- Search results made clickable under the window drag band, then portaled out of it entirely (`b1f88fc`, `86c8a2e`).
- Appearance: text-only font scale (`e0160e5`), saved palettes preserved across edits (`7d3d6ab`).

### Phase 5 — Files everywhere (4 Nov)

- **Explorer operations** that work at any root: rename, create, copy, trash (`5d136be`); OS clipboard integration with Ctrl+C/Ctrl+V and no-overwrite import (`0931f80`).
- **SSH browsing without a local folder** (`7bff1d6`) with password and keyboard-interactive prompts after connect, TOFU host keys (`c999b75`).
- **Live tool preview** — optional, read-only, theme-aware syntax palette, preserved motion on replay, full-height layout (`af349d9`, `c5d5083`, `7a7efa5`) — plus agent file preview tabs and private-LAN HTTP (`23fcb74`).
- **Web preview** attached to the chat tab, then promoted to a real **app tab** (`f92bff3`, `e7e9e62`).
- **Android Logcat** floating viewer, bounded (`511b505`).
- Replay correctness: newlines normalized before computing selection offsets (`e8a3671`), scrolling stable between frames (`b010bb1`).
- Context gauge capped at the model's real window (`9165fbb`).
- **Floating Source Control** with a tabbed diff below 760 px (`c11dcdd`, `19476cb`).

### Phase 6 — Ownership and attribution (5–6 Nov)

Attribution was the deepest correctness work in the window: *which prompt owns which file change, and how do we still know after a restart?*

- **Canonical ownership** from DB reconciliation (`ChatBubbleMessage.canonicalDbId`, `promptFileChangeOwner`), with deferred archive writes so a change lands on the right prompt.
- **Child edits retained** in chips and history (`e18a55b`), then archived per prompt with `submission_id` correlation attempts abandoned where the gateway couldn't supply receipts (`2b46596`).
- **Hybrid Git snapshots** — direct tool-edit tracking supplemented by scoped Git snapshots (`3e6a0db`): serialized queue, ignored-path enumeration, fail-closed caps, so edits made by the agent outside tool calls still appear.
- **Workspace notices before reasoning** (`2ebe088`), custom `localOnly` notices excluded from model stream bubbles (`d0d1b87`), open dialogs following live chip summaries (`eca63ed`).
- Filenames readable beside long diff statuses (`08fdcff`).
- **Default thinking level** on Providers, applied through `config.set` in the renderer (`4499dfb`).
- **Foreign turns** — sessions started by another app (Craft Anything) got a real progress indicator and a working stop: liveness from `session_turn_leases`, holder PID resolution, confirmed stop, and a bootstrap that paints `session.resume.running` immediately (`d1ba539`, `38f7f0a`).
- **Connection repair after a backend update** — the dev renderer origin was rejected because `HERMES_DESKTOP_DEV_SERVER` was never set; forwarding `ELECTRON_RENDERER_URL` fixed dashboard and Legacy chat, and `localChatTransport` is now preserved instead of flipping back to Auto (`375e813`).

### Phase 7 — Official-desktop parity (9 Nov)

- **Advanced** and **Memory & Context** panes (`2bb30d7`), then rendered as **segmented tabs** mirroring the official subpages so no group heading repeats above the first row (`5cf3eff`).
- **Keep Awake** — `off` / `while-working` / `always`, device-local in `userData/keep-awake.json`, one refcounted machine-global blocker in main, driven by the renderer's real `isLoading` (`5cf3eff`).
- **Settings modal** — larger (`min(88vw,1220px)` × `min(86vh,880px)`), 252 px rail, and the **blink** fixed: no `filter` animation on the `backdrop-filter` surface, non-destructive refetch, reserved scrollbar lane (`81ca3ec`).
- **Capabilities → Plugins** (`81ca3ec`) — a fifth tab backed by the gateway's `plugins.manage` over a short-lived `/api/ws` RPC socket, with writes restricted to toggle / update / update-all / remove.
- **Mention highlight scrolling** fixed with layout-offset math instead of viewport rects (`028392a`, `88fc9d0`), and bot chat previews clamped with ellipsis so the sidebar stops stretching.
- **Agents & Notifications** (`d9307f8`) — the official Model › Subagents and Model › Mixture of Agents subpages as tabs (delegation knobs + MoA preset editor with verified saves), plus a Notifications pane (master switch, per-kind toggles, chime, test that reports the real OS result), all device-local.
- **Fallback Models** on Providers, under Default model (`d9307f8`) — and the chain made genuinely single-source: config.yaml `fallback_providers` is authoritative, the picker publishes on every edit, and both surfaces refresh from the file (`61faa75`).

---

## 4. What ships today

**Chat** — streaming transcript with reasoning, tool replay, pinned prompts, @-mentions with mtimes and keyboard scroll, file-change chips with cumulative per-prompt summaries and historical snapshots, subagent attribution, live read-only tool preview, web preview as an app tab, last-prompt chip, manual stop including other apps' turns, send confirmation (opt-in), on-finish automation.

**Files** — multi-root explorer with bounded rows, rename/create/copy/trash at any root, OS clipboard, search, code editor with per-file autosave and folding, SSH browsing without a local checkout, image/PDF viewers.

**Source Control** — status/stage/discard, branches and upstreams, remotes, stashes (file-level), history graph with revert, UTC date filtering, ignored-path management, owned terminals, floating layout for narrow windows.

**Settings** — Appearance (themes, fonts, zoom), Shortcuts, Utils (incl. default knowledge and send confirmation), Providers (credentials, default model, default thinking, fallback chain), GitHub, Soul, Language, Memory & Context, Agents (subagents, MoA), Advanced (desktop/runtime/tools/terminal/output), Notifications, Security, Privacy, Connection, Data, About, Community, Logs.

**Capabilities** — Skills · Toolsets · Plugins · MCP · Hub.

**Knowledge** — default bundle selection per session, portable package transfer, envelope v2 injection without duplicated prompts.

---

## 5. How we work

- **Evidence over assumption.** Every claim comes from a real run: test output, `git`, or a probe against the live backend. When something couldn't be verified, it's listed as unverified rather than implied.
- **Gates before landing.** Scoped ESLint (0 errors), `npm run typecheck`, targeted Vitest with `--maxWorkers=1`, then `npm run build`. One heavy job at a time through `scripts/resource-queue.mjs`.
- **Fix the class, not the instance.** The mention scroll bug was fixed with layout math once, for every consumer, rather than patching each call site. The settings blink was traced to three compounding causes, not one.
- **Backend owns truth.** Config.yaml, `state.db`, gateway RPC. When the shell needs a value the backend already has, it reads it; it doesn't cache a second opinion (and when it must cache — like the fallback chain — it refreshes from the file and carries unknown keys through).
- **Commit always, push never (without confirmation).** Every action lands as a commit; nothing is pushed until you say so.
- **Docs move with the code.** `lat.md` gained `settings-modal`, `agents-settings`, and sections for Keep Awake, Plugins, mentions, file changes; `lat check` validates every link and code reference.

---

## 6. Where it stands

- Working tree: `custom`, in sync with `fork/custom` (last commits `61faa75`, `d9307f8`).
- Version **0.7.62**; the app on disk was left running throughout — no rebuild or restart was performed by the agent, by design.
- **Live-unverified** (code + tests green, not yet exercised against a real window): plugin list/actions against the live gateway, Keep Awake with the real Electron blocker, MoA and fallback panes against the live dashboard, notification delivery and sound, the foreign-turn spinner/stop on a real Craft Anything session, settings blink in the rebuilt app.
- **Known gaps** vs the official desktop: Quick Entry / global shortcut, rerun onboarding, provider-specific memory setup, plugin catalog install/inspect (left to the CLI and official client), advanced delegation routing backends.

---

## 7. Lessons that stuck

1. **A chip that under-reports is worse than no chip** — file-change summaries had to become cumulative, owned, and archived, or they erode trust in the whole transcript.
2. **`filter` animation on a `backdrop-filter` surface repaints the entire layer** — that was the settings blink.
3. **Viewport rects lie under transform/zoom** — layout offsets are the correct space for scroll math.
4. **A second copy of state always diverges** — the fallback chain proved it; config became the only source.
5. **Cross-process liveness needs a lease, not a flag** — `session_turn_leases` is what makes progress and stop work for turns this process never started.
6. **Tests that assert call counts must describe the real sequence** — three reads (load, verify, reload) is correct behavior, not a bug to silence.
