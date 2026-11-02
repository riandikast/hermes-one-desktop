# Token usage

The Usage page is a device-local ledger of reported token deltas, not a provider billing statement or a reconstruction of older sessions.

## Recording and synchronization

Transport events write usage directly; context-gauge rendering never creates ledger rows. This keeps estimates separate from reported usage and avoids losing rapid completions.

[[src/renderer/src/screens/Chat/Chat.tsx#Chat]] passes its recorder to both transports. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#ensureDashboardRuntimeSession]] captures cumulative counters from the resume response's `info.usage`, falling back to `session.usage` for older gateways. Fresh sessions start at zero. A completion subtracts that baseline exactly once through [[src/renderer/src/screens/Chat/hooks/useUsageTracker.tsx#tokenUsageDelta]]. Unknown baselines and counter resets re-baseline rather than fabricate historical usage. Zero input or zero output is valid when the other side increases.

[[src/renderer/src/screens/Chat/hooks/useChatIPC.ts#useChatIPC]] receives already per-request usage and records it directly. It must not subtract dashboard session counters from legacy request deltas.

The former Chat effect dropped the first resumed turn, required both counters to increase, and throttled unrelated completions for 750ms. The ledger also merged identical token counts within ten seconds, mistaking real requests for duplicates. Stable source IDs now deduplicate proven repeats; equal counts alone never do.

[[src/renderer/src/screens/Chat/hooks/useUsageTracker.tsx#useUsageTracker]] reads current localStorage before writing, preventing one mounted chat from overwriting another chat's rows or resurrecting cleared history. A same-window event updates mounted readers immediately; browser storage and focus events refresh other readers. The newest 2,000 records are retained, with totals derived from input plus output.

## Dashboard presentation

Flat, theme-aware summary cards, charts and table use shared tokens from main.css. Responsive grids stack without shrinking content; wide history stays keyboard-scrollable inside its own region.

[[src/renderer/src/screens/Usage/Usage.tsx#Usage]] displays summaries for the full retained ledger, limits the table to its latest 100 matching records, and reports filtered counts accurately. Refresh reloads local history only. Clearing still requires explicit second-click confirmation. Unreported context remains unknown rather than displaying zero percent.

## Regression coverage

Focused tests cover resumed first turns, rapid and zero-output completions, duplicate snapshots, counter resets, legacy deltas, shared writers, live updates, clearing and table filtering.

Verification also removes an unused LastPromptChip icon import that blocked renderer typechecking and updates the transport suite's stale history selector to open the current Files disclosure. Neither cleanup changes the reader's runtime behavior.

[[src/renderer/src/screens/Chat/hooks/useUsageTracker.test.ts]], [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]], [[src/renderer/src/screens/Chat/hooks/useChatIPC.test.tsx]] and [[src/renderer/src/screens/Usage/Usage.test.tsx]] exercise the transport and persistence boundaries rather than only formatting synthetic totals.
