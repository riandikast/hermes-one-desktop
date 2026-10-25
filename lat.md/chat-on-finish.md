# Chat on-finish

Saved commands run automatically only after the owning conversation and its children settle. Manual terminal commands remain immediate.

## Settled completion

A completed loading transition becomes pending until three continuous seconds of idle. Child work, pending tools, retry and fallback handoffs defer execution without deleting the saved selection.

[[src/renderer/src/screens/Chat/useSettledOnFinish.ts#useSettledOnFinish]] checks live transport refs at timer fire and again after asynchronous command lookup. Activity revisions detect child start/complete pairs between ticks. Unknown child rosters block execution until a valid snapshot arrives.

Hidden tabs remain mounted but do not poll child snapshots; automatic execution is deferred until activation and a new idle window. Run or session changes, interruption and unmount invalidate stale callbacks. A resumed main turn replaces the earlier pending completion. Persisted per-session selection is read only at execution, not from the legacy global scope.

[[src/renderer/src/screens/Chat/hooks/useActiveSubagents.ts#useActiveSubagents]] exposes the synchronous roster and its revision; snapshots replace membership while retaining sparse fields from matching previous children. Events arriving during snapshot reads take precedence.

[[src/renderer/src/screens/Chat/useOnFinishRunner.ts#useOnFinishRunner]] preserves ordered, non-overlapping launches and skips deleted commands. Automatic runs recheck validity before each launch; manual callers retain immediate execution. Already launched terminal commands are never killed.

## Existing terminal input

On-Finish sends an explicitly selected Ctrl+A–Z, Enter, Tab, Escape or Backspace, or literal text with optional Enter, to an existing terminal. Actions share the ordered queue and settled-completion safeguards.

Open the floating terminal first, then use the compact Existing terminal form: choose Key from a compact button popup or Literal text, optionally Then Enter, and Add terminal input. Literal text preserves spaces and key-like words; keys are never inferred from text. Text is limited to 1–256 UTF-16 units without control characters; terminal IDs and titles to 256, encoded records to 16384. Unknown fields, ambiguous payloads and invalid keys are rejected. Old v1 key actions remain compatible. Actions persist per chat and migrate with draft/session identity and context handoff. Closed or restarted terminal targets fail visibly; they are never redirected and never spawn a terminal. Remove an action by clicking its queue chip.

[[src/renderer/src/screens/Chat/onFinishTerminal.ts]] validates the versioned input records; [[src/renderer/src/screens/Chat/onFinishTerminal.test.tsx]] exercises actual IPC payloads, closed targets, cancellation, UI configuration, and scope migration. The old post-run keyboard banner is no longer mounted, so it cannot capture normal typing.

## Selection layout

The ordered selection badge stays immediately left of the checkmark in one non-shrinking group, keeping both aligned at the end of each command row.

The compact Key/Text form uses a closed key button and bounded in-app listbox, not a native key select or datalist. The popup chooses the larger viewport side, clamps its width and height, and scrolls overall on small screens. Queue and command list also scroll independently. Literal r uses Text with Then Enter off.

[[src/renderer/src/screens/Chat/OnFinishChip.tsx#OnFinishChip]] preserves selection order; [[src/renderer/src/screens/Chat/OnFinishChip.test.tsx]] verifies the badge and checkmark share that group.

## Execution regressions

Fake timers exercise actual commandRun calls through the settled hook and ordered runner. Child events block execution, then permit the first launch at exactly 3000ms, never 2999ms.

[[src/renderer/src/screens/Chat/useSettledOnFinish.test.tsx]] covers resumed work, retries, hidden tabs, interruption, session switch, unmount, asynchronous lookup races, rapid child lifecycles, per-launch cancellation, ordering and one-shot behavior. Existing runner and roster tests cover manual semantics and event/snapshot reconciliation.

## Inline key picker

Send key opens a 120px-max scrollable DOM popup from a compact closed button. Arrow keys, Home/End, Enter/Space, Escape, Tab and outside dismissal preserve focus and explicit Key/Text modes. No native OS popup or always-visible list is used.
