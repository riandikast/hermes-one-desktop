/**
 * Per-session PINNED CHAT MESSAGE persistence.
 *
 * Pinning a bubble in the chat transcript is a property of ONE conversation,
 * not of the mounted component. The pin used to live only on the in-memory
 * message object, so closing the chat tab (or reloading / restarting the app)
 * silently dropped every pin — the pinned bar came back empty even though the
 * session was untouched.
 *
 * Pins are keyed by the conversation identity the same way plan-mode is:
 * `sessionId` once the conversation has one, else the run id for a draft.
 * Grouping by session keeps two open chats from sharing a pinned set, and
 * `migratePinnedMessages` hands a draft's pins to its real session id on the
 * first turn.
 *
 * Only renderer-local UI state is stored (message id + role + a short text
 * preview used for the collapsed bar); nothing here touches the agent session
 * schema.
 */

const PINNED_MESSAGES_PREFIX = "hermes.session.pinnedMessages.";

export interface PinnedMessageRef {
  id: string;
  role: "user" | "agent";
  /** Short plain-text preview so the bar can render before history loads. */
  preview: string;
}

/** Key for a conversation that already has a session id. */
export function pinnedMessagesKey(identity: string): string {
  return `${PINNED_MESSAGES_PREFIX}${identity}`;
}

/**
 * Read the pinned message refs for a conversation identity. `identity` is the
 * session id when known, else the run id (new/draft chat).
 */
export function readPinnedMessages(
  identity: string | null | undefined,
): PinnedMessageRef[] {
  if (!identity) return [];
  try {
    const raw = localStorage.getItem(pinnedMessagesKey(identity));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PinnedMessageRef =>
          !!item &&
          typeof item.id === "string" &&
          (item.role === "user" || item.role === "agent"),
      )
      .map((item) => ({
        id: item.id,
        role: item.role,
        preview: typeof item.preview === "string" ? item.preview : "",
      }));
  } catch {
    return [];
  }
}

/** Persist the pinned message refs for a conversation identity. */
export function writePinnedMessages(
  identity: string | null | undefined,
  pins: PinnedMessageRef[],
): void {
  if (!identity) return;
  try {
    if (pins.length === 0) {
      localStorage.removeItem(pinnedMessagesKey(identity));
      return;
    }
    localStorage.setItem(
      pinnedMessagesKey(identity),
      JSON.stringify(pins),
    );
  } catch {
    /* storage unavailable — the in-memory state still applies */
  }
}

/**
 * Move a draft's pins onto its newly-assigned session id, so pins made before
 * the first send survive the promotion from run-scoped to session-scoped
 * identity. Clears the draft key so a later scratch chat that reuses the run id
 * does not inherit a stale pinned set.
 */
export function migratePinnedMessages(
  fromIdentity: string | null | undefined,
  toIdentity: string | null | undefined,
): void {
  if (!fromIdentity || !toIdentity || fromIdentity === toIdentity) return;
  try {
    const raw = localStorage.getItem(pinnedMessagesKey(fromIdentity));
    if (raw === null) return;
    localStorage.setItem(pinnedMessagesKey(toIdentity), raw);
    localStorage.removeItem(pinnedMessagesKey(fromIdentity));
  } catch {
    /* ignore */
  }
}

/** A bounded, single-line preview for the collapsed pinned bar entry. */
export function pinnedPreview(content: string, limit = 160): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed;
}
