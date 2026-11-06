# Turn-completion latency: tail read + tail reconcile

Cursor reads and tail reconciliation avoid rebuilding settled transcript history when a turn finishes.

Finishing a turn must not lock the UI. The completion path used to re-read the WHOLE session from state.db and re-reconcile the WHOLE transcript, which on a long conversation is a ~1.5 s stall. The fix reads and reconciles only the rows newer than the highest id the renderer already holds.

## The measured stall (real session, read-only)

Target: `20260815_004037_f049da` in the root `state.db` — 21,645 message rows, 21.3 MB of content, 29,568 renderer messages.

| step | process | measured |
| --- | --- | --- |
| SQLite SELECT of the full history | **main** | 235–291 ms |
| IPC serialize + structured clone + parse | main → renderer | ~540 ms |
| `dbItemsToChatMessages` | renderer | 22 ms |
| `reconcileAfterDbRefresh` | renderer | 711–780 ms |
| — of which `reconcileStreamedWithDb` | renderer | 666 ms |

So the lock is BOTH halves: the blocking main-process read (~235 ms) AND the renderer rebuild (~780 ms), with the renderer O(transcript) reconcile dominating. `reconcileStreamedWithDb` derives a normalized reconciliation key (`normalizeBubbleContentForMatch`) for EVERY message and every DB row — five to six full passes over ~7.7 M characters, ~116 ms each — even when only the last turn changed.

## The fix: an id cursor for the read, a tail window for the reconcile

A database-id cursor bounds completion reads; reconciliation retains the settled prefix by identity.

[[src/main/sessions.ts#buildSessionMessagesQuery]] builds the `getSessionMessages` SELECT. A positive `afterId` adds `id > ?` and keeps the canonical `ORDER BY timestamp, id`; `0`/negative keeps the full-history read (resume / reopen still need it). `id > ?` rides `idx_messages_session_id` and returns **0.0 ms** when nothing is new.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] holds `lastSyncedDbIdRef` — the highest state.db id known to be canonical in `messagesRef`. The `message.complete` sync, the foreign-turn poller, and the quiet-finalize re-baseline all keep it current; it resets to `0` on any session / connection / profile change.

[[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileTailAfterDbRefresh]] reconciles only the region from the last user row at or before the cursor onward, then splices the untouched prefix back **by identity**. `db` is the id-scoped tail, so no prefix row is ever re-read or re-normalized.

`messageDbId` parses the renderer id namespace `dbItemsToChatMessages` produces off the DB id: `db-<n>`, `db-r-<n>`, `db-tc-<n>-<cid>`, `db-tr-<n>`, `db-clarify-<n>`. Any row without such an id is renderer-only (a live clarify card, a file-changes chip, a streamed bubble) and is not a canonical prefix row.

## Two traps the tail path must handle

Negative overlay ids and late writes require explicit handling in the cursor path.

**Persisted overlays carry synthetic NEGATIVE ids.** Session-continuation history and local error rows are persisted in their own tables and re-emitted by [[src/main/sessions.ts#applySessionLocalOverlays]] on EVERY read — including a cursor-scoped tail read. They use negative ids out of the store's synthetic ranges (`-900_000_000`, `-800_000_000`). `messageDbId` therefore returns their (negative) value rather than `0`, so `isCanonicalPrefix` accepts them; treating them as renderer-only would make every session with continuation history fall back to the full reconcile forever.

**Overlays are re-prepended, so `db` must be filtered to the tail.** Because they reappear in a tail read, [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileTailAfterDbRefresh]] filters `db` down to real ids newer than the cursor before merging. Otherwise the merge sees overlay rows in `db` that are absent from `tailCurrent` and re-appends them to the tail — duplicating the whole continuation block. Both traps are pinned in `turn-completion-tail-reconcile.test.ts`.

## Why the prefix splice is safe, and when it defers

Only settled rows survive the prefix splice; pending or local-only rows force a full reconciliation.

Reconciliation is per-turn: the merge can only add, drop, or reorder rows WITHIN the active turn. That turn's user row is always inside the tail window, so the tail reconcile sees every row its decisions can touch. Everything before it is a settled state.db row — carrying it over by identity is exactly what the previous reconcile would have produced, minus the work.

[[src/renderer/src/screens/Chat/sessionHistory.ts#isCanonicalPrefix]] guards the rest: if any prefix row is renderer-only (no db id) or is a pending / local-only / errored bubble, the prefix is not settled and the call falls back to the full [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileAfterDbRefresh]].

The backward walk that finds the tail boundary stops at the first canonical prefix row (id ≤ cursor), not merely at the first user row — scanning for a user row would itself be O(transcript). A short second walk moves the boundary back to the last user row so the merge keeps its per-turn invariant.

## The quiet-finalize path deliberately keeps the full read

Quiet-finalize needs full user-message counts to prove that persisted history caught up.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]]'s quiet-finalize recovery (~10 s of gateway silence) compares WHOLE-session user counts against the live transcript to decide whether state.db has caught up — a tail read would break that catch-up guard. It keeps its full read and full reconcile, and only re-baselines `lastSyncedDbIdRef` afterwards so the NEXT completion is fast again. It is a rare recovery path, not the hot one.

## Reopening a session that another app is running

A reopened chat shows live progress immediately when its turn runs in another process, and its Stop button can actually end that turn.

`session.active_list` only lists live sessions in the backend THIS window spawned. An app that drives its own `hermes` run (a CLI/oneshot client such as Craft Anything) writes the transcript through a different process, so the desktop's backend neither lists it nor reports `running` on resume — the chat looked idle while another app was mid-turn, with no interrupt button.

Three signals now cover it:

- **Resume flag.** The mount bootstrap uses `session.resume`'s own `running` (`runtimeWasRunningRef`, captured inside `ensureRuntimeSession`, which resolves only the id) and paints `beginForeignTurn` before the first poll. The bootstrap reads its callbacks through refs and keeps `ensureClient`/`ensureRuntimeSession`/`beginForeignTurn` out of its dependency array — with them in deps, any unrelated re-render cancelled the in-flight attach, and the effect's cleanup then cleared the spinner it had just set.
- **Cross-process turn lease.** Every runtime takes a `session_turn_leases` row in state.db for the duration of a turn and deletes it when the turn ends. [[src/main/turn-activity.ts#getSessionTurnActivity]] resolves the conversation's lineage root (following `end_reason = 'compression'` parents, mirroring the backend), reads the row, parses `pid=`/`platform=`, and probes the PID: a dead holder means finished, a live holder keeps the lease authoritative for 2 minutes past expiry (the row is refreshed on transcript writes, so a long silent model call can outlive the TTL). The poller adds that lease to `session.active_list` each 2s tick, so a session owned by another process shows its spinner and finalizes when the lease disappears.
- **Opening a chat is not local activity.** `lastLocalActivityAtRef` starts at `0` on a session/connection reset and is only stamped by real sends and finishes, so the 5s "let the gateway settle" grace no longer hides a turn that was already running when the tab opened.

The poller also matches `session.active_list` rows by runtime id **or** the stored session key, no longer requires a runtime id, and keeps polling a foreign turn it painted itself (a local-turn guard would have dropped it on the next tick). Only an effect run that painted the spinner may clear it.

**Stopping a foreign turn.** `session.interrupt` reaches only this backend, so [[src/main/turn-activity.ts#stopSessionTurn]] terminates the lease holder instead — after an explicit `appConfirm` naming the pid and platform, and never when the holder is the desktop's own backend ([[src/main/dashboard.ts#getManagedDashboardPids]]) or this process. Exposed as `getSessionTurnActivity`/`stopSessionTurn` over IPC and preload; the confirm path lives in `useDashboardChatTransport`'s `abort`.

Pinned by `useDashboardChatTransport.test.tsx` ("paints progress immediately when a reopened session is still running in another client", "paints progress from the state.db turn lease when another process owns the turn", "picks up a turn another process starts while the tab is open", "detects an external app's running turn by stored key even when our own attach is refused", "stops a turn owned by another process only after the user confirms", "stays idle when the reopened session is not running anywhere") and [[src/main/turn-activity.test.ts]] against a real SQLite schema.

## Result (same real session, same code path)

Measured completion timings compare full-history and cursor-scoped paths on the same session.

- main-process read: **290.9 ms → 0.0 ms**
- renderer reconcile: **~705 ms → ~9 ms** (78×)

Correctness is pinned by `tests/session-history.bench.test.ts`: the prefix is preserved by object identity (29412 rows) and the tail region reconciles identically to the full reconcile. The regression tests are `turn-completion-tail-reconcile.test.ts` and `session-messages-tail-read.test.ts`.

The tail path also stops the full reconcile's habit of re-churning deep historical duplicate-user rows on every pass: on this session the whole-transcript reconcile is not a stable fixed point (it keeps dropping ~150 old rows per call), whereas the tail path leaves settled history alone.

## Reproducing the measurement

The DB rows are extracted once (read-only) so the benchmark runs under plain vitest without the Electron-only native sqlite module:

```
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/_bench-extract-rows.mjs
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/_bench-main-read.mjs
npx vitest run tests/session-history.bench.test.ts --disable-console-intercept
```
