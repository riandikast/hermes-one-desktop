# Desktop reliability and GitHub settings

Chat recovery waits for backend confirmation, model changes serialize on control sockets, and Settings exposes explicit native GitHub browser sign-in.

## Chat recovery and file history

Provider retry countdowns remain informational until cancellation or failure is confirmed; payload overflow compresses once before replay. Completed tools publish file changes without waiting for turn completion.

The transport and regression coverage live in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]], [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]], [[src/renderer/src/screens/Chat/hooks/modelSelection.integration.test.tsx]], and [[src/renderer/src/screens/Chat/providerRetry.test.tsx]]. Folder chips retain base-folder controls and terminal right-click copies selected text.

## GitHub browser sign-in

Settings lists native accounts and verifies only the pinned GitHub HTTPS username. Explicit selection persists the current OS user’s Git default; credentials never cross IPC.

GCM 2.7.3 supports `github list` (one account per line) and `github login --browser`, but login emits no identity. A single newly added account is verified and pinned; existing-account reauthentication requires explicit selection, never a first-credential guess. Only user clicks mutate auth/config. The pin is `credential.https://github.com.username` in user-global Git config, not machine-wide; repository config and remote URL usernames can override it. SSH, remote agents, and app-specific encrypted PAT overrides remain separate.

See [GCM multiple-user documentation](https://github.com/git-ecosystem/git-credential-manager/blob/v2.7.3/docs/multiple-users.md). Account-filtering and sticky defaults have mocked coverage in [[src/main/github-auth-accounts.test.ts]].

Implementation: [[src/main/github-auth.ts]], [[src/renderer/src/components/settings/GitHubPane.tsx]]. Mocked regressions: [[src/main/github-auth.test.ts]], [[src/renderer/src/components/settings/GitHubPane.test.tsx]]. No app restart or live authentication is implied by unit-test success.
