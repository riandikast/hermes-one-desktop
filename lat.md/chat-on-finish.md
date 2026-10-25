# Chat on-finish

Saved commands run automatically only after the owning conversation and its children settle. Manual terminal commands remain immediate.

## Settled completion

A completed loading transition becomes pending until three continuous seconds of idle. Child work, pending tools, retry and fallback handoffs defer execution without deleting the saved selection.

[[src/renderer/src/screens/Chat/useSettledOnFinish.ts#useSettledOnFinish]] checks live transport refs at timer fire and again after asynchronous command lookup. Activity revisions detect child start/complete pairs between ticks. Unknown child rosters block execution until a valid snapshot arrives.

Hidden tabs remain mounted but do not poll child snapshots; automatic execution is deferred until activation and a new idle window. Run or session changes, interruption and unmount invalidate stale callbacks. A resumed main turn replaces the earlier pending completion. Persisted per-session selection is read only at execution, not from the legacy global scope.

[[src/renderer/src/screens/Chat/hooks/useActiveSubagents.ts#useActiveSubagents]] exposes the synchronous roster and its revision; snapshots replace membership while retaining sparse fields from matching previous children. Events arriving during snapshot reads take precedence.

[[src/renderer/src/screens/Chat/useOnFinishRunner.ts#useOnFinishRunner]] preserves ordered, non-overlapping launches and skips deleted commands. Automatic runs recheck validity before each launch; manual callers retain immediate execution. Already launched terminal commands are never killed.

## Execution regressions

Fake timers exercise actual commandRun calls through the settled hook and ordered runner. Child events block execution, then permit the first launch at exactly 3000ms, never 2999ms.

[[src/renderer/src/screens/Chat/useSettledOnFinish.test.tsx]] covers resumed work, retries, hidden tabs, interruption, session switch, unmount, asynchronous lookup races, rapid child lifecycles, per-launch cancellation, ordering and one-shot behavior. Existing runner and roster tests cover manual semantics and event/snapshot reconciliation.
