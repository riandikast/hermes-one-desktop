# Backend update verification

About checks installed backend commits against fresh official repository metadata, independently of the desktop release feed and cached CLI version text.

## Official source

[[src/main/backend-update.ts#checkBackendUpdate]] reads installed HEAD without changing the checkout, discovers the default branch from NousResearch/hermes-agent, resolves its current SHA, and compares immutable commits via GitHub.

Matching SHAs alone mean current. Behind means an update is available; ahead and diverged stay distinct. Detached HEAD is checked by commit. Missing Git metadata, unknown commits, malformed responses, timeouts and API errors mean unknown, never current. A compare 404 probes installed SHA publication; an unpublished SHA walks at most 20 local first-parent ancestors to find a published base, then reports custom divergence with the base’s upstream relationship and manual official-source instructions. Genuine endpoint and network errors retain their stage and known commit details; no fetch or ancestry guess occurs; only actual local ancestry and fresh official metadata are used. A missing published base stays unknown, never current. Remote/SSH installations report unknown rather than checking the local installation. Non-default release channels require manual review; this check targets the official default branch.

[[src/renderer/src/components/settings/AboutPane.tsx]] shows the official source URL, comparison details and retry. It never infers currency from a missing update banner. Desktop releases remain on riandikast/hermes-one-desktop.

## Execution safety

[[src/main/backend-update.ts#assertOfficialBackendUpdateTarget]] guards the existing CLI update path with an official origin, verified behind state and checked-out default branch.

Custom origins, detached checkouts and diverged history require manual review rather than silently updating a fork or switching branches. The check itself never fetches, installs or modifies backend files. No backend updater is invoked during regression tests.

## Regression coverage

[[src/main/backend-update.test.ts]] covers current, ahead, behind, detached, diverged, official metadata URLs, custom origins, non-Git installs and check failures.

[[src/renderer/src/components/settings/AboutPane.backend.test.tsx]] verifies truthful About badges, retry and separate backend/desktop sources. [[tests/onfinish-update-structure.test.ts]] checks IPC/preload wiring and independent scroll bounds. [[src/renderer/src/screens/Chat/onFinishTerminal.test.tsx]] checks collapsed DOM popup key selection and keyboard focus, viewport placement and literal r versus Ctrl+R ordering.
