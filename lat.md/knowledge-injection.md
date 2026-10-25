# Knowledge bundle injection

The dashboard includes fresh selected Knowledge indexes in user-message text, without backend patches, extra RPC fields, system authority or Knowledge-driven session recreation.

## How the index reaches the model

Every dashboard submit fetches the selected index immediately before dispatch, including unchanged selections so edits appear next turn.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] discards stale selection reads and checks cancellation. Fetch errors and empty enabled indexes visibly fail without submission or silent omission. Removal excludes the index from future prompts. Background prompts use the same user-data format.

## Text envelope and history

[[src/shared/knowledge-envelope.ts#encodeKnowledgePrompt]] stores exact original text and references in a canonical v2 envelope. Attachment-expanded text is included only when different, avoiding a second copy of ordinary prompts.

The introduction labels references user-supplied data, not system instructions. [[src/shared/knowledge-envelope.ts#decodeKnowledgePrompt]] requires exact whole-string canonical validation, version, types and keys. Malformed, partial, embedded and suffixed lookalikes remain unchanged. This marker is not cryptographic provenance: deliberately copying a valid envelope is indistinguishable from desktop output.

[[src/renderer/src/screens/Chat/sessionHistory.ts#stripKnowledgeIndexHeader]] decodes valid user envelopes at the DB-to-UI boundary. Ordinary text preserves whitespace. Optimistic bubbles, recovery source prompts, transcript/checkpoint snapshots, input history and unsend/edit callbacks retain original text. Image staging and attachment references remain unchanged. Slash routing precedes augmentation; command execution and clarify responses retain existing protocols.

## Backend delivery contract

Only existing `text` changes; no capability endpoint, Knowledge parameter, compatibility installer or backend mutation is required.

Session-not-found replay resends the same envelope once. Actual recovery sends rebuild from original text with a fresh index, never recursive wrapping. Historical messages are not globally rewritten. Folder hints remain creation-time context; new sessions receive no Knowledge system seeds.

## Unsupported routes and old sessions

Selection changes affect future indexes only; previous user reference context and legacy durable system seeds can remain in backend history.

No session recreation or clean-session requirement is imposed. Ambiguous unversioned user prefixes are not heuristically stripped. Legacy HTTP transport behavior is unchanged; this dashboard implementation does not repair that separate system-instruction route. Raw backend search indexes retain envelope text; search-rendered user rows use the strict decoder. Other clients may display stored wire text.

## Rollout

Source changes and offline tests perform no backend installation, paid provider call, user DB edit, build, restart, credential change, commit or push.

Desktop deployment is separate; changes are not claimed to be loaded in the running app.

## Index wording and hints

[[src/main/knowledge.ts#buildKnowledgeIndex]] remains unchanged: selected paths and short relevance hints, not full contents.

Full contents require file tools and permissions. The model may ignore references. Delivery is not obedience; prior context persists and fresh indexes consume tokens under existing provider limits.

## Prompt size and submission audit

Normal tool events update the renderer transcript without resubmitting a prompt or sending that transcript to the dashboard again.

Mounted tests drive thirty tool start/complete pairs after one manual send, for fresh and resumed sessions. They assert one `prompt.submit`, one index read, no new session creation during events, and no transcript field in the submit payload.

Canonical v1 history remains readable. V2 only removes duplicate ordinary prompt text; it does not rewrite previous history, omit fresh indexes, alter backend compression, or prove the cause of historical provider usage. [[src/shared/knowledge-envelope.test.ts]] guards wire size, attachment expansion, old history and malformed envelopes.

## Synthetic transport diagnostics

Offline mounted tests assert actual payloads and decoded history, not merely reconnects or a model's claimed awareness.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx]] covers fresh/resumed sends, change/removal without churn, unchanged-selection refresh, removal races, cancellation, visible fetch failure, original reopened history, malformed envelopes and one session-not-found replay. Existing attachment, command and recovery tests remain applicable. No live-provider obedience or installed-runtime behavior is claimed.
