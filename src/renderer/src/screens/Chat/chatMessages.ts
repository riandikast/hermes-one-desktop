import type { ActiveTurn, ChatBubbleMessage, ChatMessage } from "./types";

export function isBubbleMessage(m: ChatMessage): m is ChatBubbleMessage {
  const kind = (m as { kind?: string }).kind;
  return !kind || kind === "user" || kind === "assistant";
}

export function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isAssistantError(
  m: ChatMessage,
): m is ChatBubbleMessage & { role: "agent"; error: string } {
  return isBubbleMessage(m) && m.role === "agent" && !!m.error;
}

export function shouldSendToAgent(m: ChatMessage): m is ChatBubbleMessage {
  return (
    isBubbleMessage(m) &&
    !m.localOnly &&
    !m.error &&
    normalizeMessageText(m.content).length > 0
  );
}

export function shouldCopyToTranscript(m: ChatMessage): m is ChatBubbleMessage {
  return (
    isBubbleMessage(m) &&
    (!!m.error || normalizeMessageText(m.content).length > 0)
  );
}

export function displayTextForTranscript(m: ChatBubbleMessage): string {
  if (m.error && !normalizeMessageText(m.content)) return `Error: ${m.error}`;
  if (m.error) return `${m.content.trim()}\n\nError: ${m.error}`;
  return m.content.trim();
}

/**
 * Transient/protocol noise that is not actionable by the user and must never
 * reach the transcript as a persistent error bubble.
 *
 * These two are emitted by the transport/validator, not by the agent, and both
 * are self-clearing or outright spurious:
 *
 *  - `raw_system_prompt: Extra inputs are not permitted` — a version-skew
 *    complaint from the client/backend schema boundary. The string exists in
 *    neither the fork nor any backend release, so there is nothing for the user
 *    to fix; the prompt itself still runs. Showing it is pure noise.
 *  - `open in another Hermes window/terminal` / `SESSION_NOT_OWNED` — an
 *    ownership refusal. When it is genuine it clears by retrying; when it is
 *    stale (a dead lease holder, or a phantom session) it is wrong and cannot be
 *    acted on from this window. The owning window, not this banner, is the place
 *    to resolve it.
 *
 * Matching is deliberately narrow — a specific phrase, not a broad category —
 * so real provider/transport failures keep their bubble. See
 * `chatMessages.test.ts` for the contract.
 */
const SILENCED_ERROR_PATTERNS: readonly RegExp[] = [
  /raw_system_prompt/i,
  /open in another Hermes window/i,
  /SESSION_NOT_OWNED/,
  /already has a live owner/i,
];

export function isSilencedErrorMessage(error: string): boolean {
  const text = (error || "").trim();
  if (!text) return false;
  return SILENCED_ERROR_PATTERNS.some((re) => re.test(text));
}

function formatErrorMessage(error: string): string {
  const text = error.trim();
  // Suppressed noise collapses to an empty string so callers can skip the row
  // entirely instead of rendering an empty error bubble.
  if (isSilencedErrorMessage(text)) return "";
  return text || "Hermes reported an error";
}

function findActiveUserIndex(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null | undefined,
): number {
  if (activeTurn) {
    const byId = messages.findIndex((m) => m.id === activeTurn.userId);
    if (byId >= 0) return byId;

    const byTurn = messages.findIndex(
      (m) =>
        isBubbleMessage(m) &&
        m.role === "user" &&
        m.turnId === activeTurn.turnId,
    );
    if (byTurn >= 0) return byTurn;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isBubbleMessage(m) && m.role === "user") return i;
  }
  return -1;
}

function findActiveAssistantIndex(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null | undefined,
  userIndex: number,
): number {
  for (let i = messages.length - 1; i > userIndex; i--) {
    const m = messages[i];
    if (isBubbleMessage(m) && m.role === "user") break;
    if (!isBubbleMessage(m) || m.role !== "agent") continue;
    if (!activeTurn || !m.turnId || m.turnId === activeTurn.turnId) return i;
  }
  return -1;
}

function activeTurnInsertIndex(
  messages: ReadonlyArray<ChatMessage>,
  userIndex: number,
): number {
  if (userIndex < 0) return messages.length;
  let insertAt = userIndex + 1;
  while (
    insertAt < messages.length &&
    !(isBubbleMessage(messages[insertAt]) && messages[insertAt].role === "user")
  ) {
    insertAt++;
  }
  return insertAt;
}

export function markActiveTurnFailed(
  messages: ReadonlyArray<ChatMessage>,
  error: string,
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  const errorText = formatErrorMessage(error);
  const userIndex = findActiveUserIndex(messages, activeTurn);

  // Silenced noise (see SILENCED_ERROR_PATTERNS): the turn still has to end —
  // the spinner must stop — but nothing is written to the transcript, so the
  // user never sees a bubble they can neither act on nor dismiss.
  if (!errorText) {
    return messages.map((m) => {
      if (!isBubbleMessage(m)) return m;
      const contentLooksLikeError = /^\s*error\s*:/i.test(m.content || "");
      const isTurnRow =
        (activeTurn
          ? m.turnId === activeTurn.turnId || m.id === activeTurn.userId
          : false) || (m.localOnly === true && !!m.error);
      if (!isTurnRow) return m;
      return {
        ...m,
        content: contentLooksLikeError ? "" : m.content,
        error: undefined,
        pending: false,
      } as ChatMessage;
    });
  }

  const assistantIndex = findActiveAssistantIndex(
    messages,
    activeTurn,
    userIndex,
  );

  if (assistantIndex >= 0) {
    return messages.map((m, index) => {
      if (index !== assistantIndex || !isBubbleMessage(m)) return m;
      const contentLooksLikeError = /^\s*error\s*:/i.test(m.content || "");
      return {
        ...m,
        content: contentLooksLikeError ? "" : m.content,
        error: errorText,
        pending: false,
        localOnly: true,
        turnId: m.turnId || activeTurn?.turnId,
      };
    });
  }

  const row: ChatBubbleMessage = {
    id: `error-${Date.now()}`,
    role: "agent",
    content: "",
    error: errorText,
    pending: false,
    localOnly: true,
    ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
  };

  const insertAt = activeTurnInsertIndex(messages, userIndex);
  return [...messages.slice(0, insertAt), row, ...messages.slice(insertAt)];
}

export function createTurn(
  idPrefix = "user",
): Pick<ActiveTurn, "turnId" | "userId"> {
  const stamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  return {
    turnId: `turn-${stamp}-${nonce}`,
    userId: `${idPrefix}-${stamp}-${nonce}`,
  };
}

/**
 * Drop stale turn-failure bubbles once a NEW turn starts.
 *
 * A failed send (`markActiveTurnFailed`) writes its error INTO the transcript as
 * a renderer-only bubble (`localOnly: true`) — there is no toast. Nothing ever
 * removed one, so an error from a transient refusal (e.g. the backend's
 * "chat is open in another Hermes window/terminal" lease conflict, which clears
 * on its own) stayed on screen permanently and looked like a live fault hours
 * later.
 *
 * Only renderer-only error bubbles are removed: a canonical DB row
 * (`db-<n>`) that carries an `error` is real conversation history and is left
 * alone, as is anything still pending.
 */
export function clearStaleTurnErrors(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  const kept = messages.filter((m) => !isStaleTurnError(m));
  return kept.length === messages.length ? [...messages] : kept;
}

function isStaleTurnError(m: ChatMessage): boolean {
  if (!isBubbleMessage(m)) return false;
  if (!m.error) return false;
  if (m.pending) return false;
  // Canonical rows come from state.db and encode real history.
  if (/^db-/.test(String(m.id ?? ""))) return false;
  return m.localOnly === true;
}
