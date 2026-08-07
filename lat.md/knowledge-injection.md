# Knowledge bundle injection

When a chat attaches knowledge bundles, their content index is injected as a **system-role seed message** so the agent treats the files as context — the index is never prepended to the user's prompt text (which would leak the system prompt into the visible user bubble).

## How the index reaches the model

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#ensureDashboardRuntimeSession]] injects the index as a `system` seed message at `session.create`. The legacy transport ([[src/main/hermes.ts]]) instead re-injects it per request; the dashboard path can't — its turns resume via `session.resume`/`prompt.submit`, which carry no per-turn instructions.

## Index wording + hints

`buildKnowledgeIndex` ([[src/main/knowledge.ts#buildKnowledgeIndex]]) emits one assertive instruction line plus a per-bundle file list.

The instruction frames the files as the user's AUTHORITATIVE context and tells the model to open a file with its file tools whenever a listed file COULD be relevant — the hint line is only a pointer, so the model must open the file for its full content before deciding it is not relevant. This stronger framing (vs the old soft "read when relevant") makes the model actually consult the bundles instead of silently judging them irrelevant from a cryptic title.

Each file's hint is the first non-empty line, truncated to 140 chars. When that line is a short markdown heading (≤60 chars) the start of the next non-empty line is appended ("`# Title — subtitle`"), so relevance is recognizable without dumping contents. A long prose first line already carries meaning, so no second line is pulled — the hint stays a pointer, not a content dump, inside the index budget.

## Single-shot limitation

On the dashboard transport the index is seeded only at `session.create`; resumed turns cannot carry a fresh seed. A RACE GUARD in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#ensureDashboardRuntimeSession]] fetches the index inline (awaiting `getKnowledgeIndex`) when the async effect hasn't populated the ref yet — without it, toggling knowledge on and sending immediately could create the session with an EMPTY index ("toggle on but the model doesn't know the knowledge files"). The injected intro now carries a SNAPSHOT warning: the model must list the knowledge directory with its file tools and read the current content before writing, and must write to the EXACT absolute path in the index (never guess a path/filename) — this corrects stale-index wrong-file writes mid-session. Short-heading hints append the next line so files are more distinguishable.

`session.resume`/`prompt.submit` accept only `{session_id, text, profile}`, so a bundle toggled on **mid-conversation** does not take effect until a new session is created, and the instruction recedes over a long conversation (recency / lost-in-the-middle). The toggle is persisted per session in `localStorage` (`hermes.session.knowledge.<id>`, managed in [[src/renderer/src/screens/Chat/Chat.tsx]]), so "always on" reliably injects on the first turn of each new chat. Fully re-seeding mid-conversation would require force-creating a fresh session (new stored id) and re-keying the localStorage attachment — intentionally not automated, because the id change would erase the just-made toggle via the load-on-id-change effect, and the `session.create` flow can't be integration-tested locally.
