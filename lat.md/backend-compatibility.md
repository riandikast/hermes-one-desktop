# Backend compatibility

Desktop audits source without rewriting an installation from About. Legacy startup compatibility remains scoped to dashboard chat and the fork's saved-model library.

## Read-only audit

About's Check Backend Compatibility action inspects local source only. SSH and HTTP return an explicit unavailable result; neither falls through to a local installation.

[[src/main/hermes-agent-compat.ts#inspectLocalDashboardCompatibility]] never writes markers, backups or source. Missing source fails closed. Legacy changes are reported as required, not applied. `tests/hermes-agent-compat.test.ts` verifies temporary fixture trees and the IPC boundary.

## Current upstream and legacy compatibility

Modular upstream model routes must not receive the monolithic legacy injection. Basic model selection and chat are upstream features; remote saved-library CRUD remains a fork extension.

[[src/main/hermes-agent-compat.ts#patchDashboardModelLibrarySource]] recognizes `app.include_router(_models_routes.router)` and leaves the source unchanged. Local and SSH startup retain the old chat-default/model-library shim for recognized older sources. Unknown source layouts fail rather than receive speculative edits. About results describe source capability, not running-process health or an installed engine version.

The previous gateway slash-command aliases and two console-flash edits are removed. They targeted modules that no longer own those functions, were unrelated to dashboard compatibility, and could report successful compatibility after doing nothing. No replacement edits are applied to the new upstream owners.

Upstream documents maintenance at https://hermes-agent.nousresearch.com/docs/getting-started/updating and supported dashboard backend extensions at https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard. Dependency repair (`hermes pm repair`) is not a substitute for source compatibility and is not invoked by this diagnostic.
