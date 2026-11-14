# Desktop reliability and GitHub settings

Chat recovery waits for backend confirmation, model changes serialize on control sockets, and Settings exposes explicit native GitHub browser sign-in.

## Chat recovery and file history

Provider retry countdowns remain informational until cancellation or failure is confirmed; payload overflow compresses once before replay. Completed tools publish file changes without waiting for turn completion.

The transport and regression coverage live in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]], [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]], [[src/renderer/src/screens/Chat/hooks/modelSelection.integration.test.tsx]], and [[src/renderer/src/screens/Chat/providerRetry.test.tsx]]. Folder chips retain base-folder controls and terminal right-click copies selected text.

## GitHub browser sign-in

Settings lists native accounts and verifies only the pinned GitHub HTTPS username. Explicit selection persists the current OS user’s Git default; credentials never cross IPC.

GCM 2.7.3 supports `github list` (one account per line) and `github login --browser`, but login emits no identity. A single newly added account is verified and pinned; existing-account reauthentication requires explicit selection, never a first-credential guess. Only user clicks mutate auth/config. The pin is `credential.https://github.com.username` in user-global Git config, not machine-wide. Source Control network commands apply that username and the manager helper as GitHub URL-scoped command options, overriding repository defaults without editing them. Git subprocesses use the same native credential store as Settings. Explicit usernames embedded in remote URLs and SSH keys remain separate; use username-free HTTPS URLs for the selected account. Regression: [[src/main/git-network-auth.test.ts]].

See [GCM multiple-user documentation](https://github.com/git-ecosystem/git-credential-manager/blob/v2.7.3/docs/multiple-users.md). Account-filtering and sticky defaults have mocked coverage in [[src/main/github-auth-accounts.test.ts]].

Disconnect removes the named account from GCM and clears the pin only when it names that account. A pin can outlive the credential (another config scope or a manual edit), so `status()` must never resurrect a pinned name the manager no longer lists: that union in the renderer's account picker made a removed account reappear. A `github logout` exit of 0 is also not proof of removal; the returned status is re-read and the action reports `failed` if the account is still listed.

Implementation: [[src/main/github-auth.ts]], [[src/renderer/src/components/settings/GitHubPane.tsx]]. Mocked regressions: [[src/main/github-auth.test.ts]], [[src/renderer/src/components/settings/GitHubPane.test.tsx]]. No app restart or live authentication is implied by unit-test success.
