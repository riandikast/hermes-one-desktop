# Desktop reliability and GitHub settings

Chat recovery waits for backend confirmation, model changes serialize on control sockets, and Settings exposes explicit native GitHub browser sign-in.

## Chat recovery and file history

Provider retry countdowns remain informational until cancellation or failure is confirmed; payload overflow compresses once before replay. Completed tools publish file changes without waiting for turn completion.

The transport and regression coverage live in [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]], [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]], [[src/renderer/src/screens/Chat/hooks/modelSelection.integration.test.tsx]], and [[src/renderer/src/screens/Chat/providerRetry.test.tsx]]. Folder chips retain base-folder controls and terminal right-click copies selected text.

## GitHub browser sign-in

Settings checks native credential availability without opening a browser. Only an explicit sign-in click starts Git Credential Manager browser authentication; credentials and process output never cross IPC.

Implementation: [[src/main/github-auth.ts]], [[src/renderer/src/components/settings/GitHubPane.tsx]]. Mocked regressions: [[src/main/github-auth.test.ts]], [[src/renderer/src/components/settings/GitHubPane.test.tsx]]. No app restart or live authentication is implied by unit-test success.
