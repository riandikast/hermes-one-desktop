# Turn-completion latency: tail read + tail reconcile

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

[[src/main/sessions.ts#buildSessionMessagesQuery]] builds the `getSessionMessages` SELECT. A positive `afterId` adds `id > ?` and keeps the canonical `ORDER BY timestamp, id`; `0`/negative keeps the full-history read (resume / reopen still need it). `id > ?` rides `idx_messages_session_id` and returns **0.0 ms** when nothing is new.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] holds `lastSyncedDbIdRef` — the highest state.db id known to be canonical in `messagesRef`. The `message.complete` sync, the foreign-turn poller, and the quiet-finalize re-baseline all keep it current; it resets to `0` on any session / connection / profile change.

[[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileTailAfterDbRefresh]] reconciles only the region from the last user row at or before the cursor onward, then splices the untouched prefix back **by identity**. `db` is the id-scoped tail, so no prefix row is ever re-read or re-normalized.

`messageDbId` parses the renderer id namespace `dbItemsToChatMessages` produces off the DB id: `db-<n>`, `db-r-<n>`, `db-tc-<n>-<cid>`, `db-tr-<n>`, `db-clarify-<n>`. Any row without such an id is renderer-only (a live clarify card, a file-changes chip, a streamed bubble) and is not a canonical prefix row.

## Two traps the tail path must handle

**Persisted overlays carry synthetic NEGATIVE ids.** Session-continuation history and local error rows are persisted in their own tables and re-emitted by [[src/main/sessions.ts#applySessionLocalOverlays]] on EVERY read — including a cursor-scoped tail read. They use negative ids out of the store's synthetic ranges (`-900_000_000`, `-800_000_000`). `messageDbId` therefore returns their (negative) value rather than `0`, so `isCanonicalPrefix` accepts them; treating them as renderer-only would make every session with continuation history fall back to the full reconcile forever.

**Overlays are re-prepended, so `db` must be filtered to the tail.** Because they reappear in a tail read, [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileTailAfterDbRefresh]] filters `db` down to real ids newer than the cursor before merging. Otherwise the merge sees overlay rows in `db` that are absent from `tailCurrent` and re-appends them to the tail — duplicating the whole continuation block. Both traps are pinned in `turn-completion-tail-reconcile.test.ts`.

## Why the prefix splice is safe, and when it defers

Reconciliation is per-turn: the merge can only add, drop, or reorder rows WITHIN the active turn. That turn's user row is always inside the tail window, so the tail reconcile sees every row its decisions can touch. Everything before it is a settled state.db row — carrying it over by identity is exactly what the previous reconcile would have produced, minus the work.

[[src/renderer/src/screens/Chat/sessionHistory.ts#isCanonicalPrefix]] guards the rest: if any prefix row is renderer-only (no db id) or is a pending / local-only / errored bubble, the prefix is not settled and the call falls back to the full [[src/renderer/src/screens/Chat/sessionHistory.ts#reconcileAfterDbRefresh]].

The backward walk that finds the tail boundary stops at the first canonical prefix row (id ≤ cursor), not merely at the first user row — scanning for a user row would itself be O(transcript). A short second walk moves the boundary back to the last user row so the merge keeps its per-turn invariant.

## The quiet-finalize path deliberately keeps the full read

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]]'s quiet-finalize recovery (~10 s of gateway silence) compares WHOLE-session user counts against the live transcript to decide whether state.db has caught up — a tail read would break that catch-up guard. It keeps its full read and full reconcile, and only re-baselines `lastSyncedDbIdRef` afterwards so the NEXT completion is fast again. It is a rare recovery path, not the hot one.

## Result (same real session, same code path)

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
