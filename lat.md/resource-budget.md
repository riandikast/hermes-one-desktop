# Resource budget

Test and typecheck scripts share a host-local execution queue. Vitest uses at most two workers to keep the desktop responsive while multiple chat sessions are active.

The queue listens exclusively on localhost port 47839 for the lifetime of the Node job. Other queued jobs wait up to thirty minutes. Process exit releases the lock automatically. Direct commands bypass the queue; this is not an OS CPU quota.

Run `node scripts/resource-queue.test.mjs` to check serialization, failure exit codes, and lock release. Agent rules in AGENTS.md require targeted tests, retained logs, browser reuse, and no duplicate desktop launches.

## Renderer typecheck and test boundaries

Renderer checks include Node declarations for colocated Vitest tests; browser production modules still avoid Node imports. Cached session pages retain both DB cursors for incremental polling.

[[tsconfig.web.json]] supplies test Node types; browser interval refs remain numeric. [[vitest.config.ts]] processes `main.css` so raw stylesheet imports work in tests without filesystem fallbacks in [[src/renderer/src/theme/themeEditor.ts]]. Theme parsing tests verify all built-in palettes.

[[src/shared/session-history.ts#SessionHistoryRow]] matches persisted file-change metadata. Handoff and run state reuse [[src/shared/model-override.ts#SessionModelOverride]]; handoff results expose their actual bubble type. [[src/renderer/src/screens/Chat/chatWiring.test.ts]] guards the newest cursor in the Layout startup cache.

Callback harnesses match the current Chat contracts: automatic terminal opening opts into directory reuse, explicit creation starts another shell, and model-selection fixtures supply the settled-command cancellation callback.
