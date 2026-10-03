# Resource budget

Test and typecheck scripts share a host-local execution queue. Vitest uses at most two workers to keep the desktop responsive while multiple chat sessions are active.

The queue listens exclusively on localhost port 47839 for the lifetime of the Node job. Other queued jobs wait up to thirty minutes. Process exit releases the lock automatically. Direct commands bypass the queue; this is not an OS CPU quota.

Run `node scripts/resource-queue.test.mjs` to check serialization, failure exit codes, and lock release. Agent rules in AGENTS.md require targeted tests, retained logs, browser reuse, and no duplicate desktop launches.
