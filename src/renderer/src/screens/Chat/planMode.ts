/**
 * Per-session PLAN / BUILD mode persistence.
 *
 * The mode is a property of ONE conversation, not of the app: toggling PLAN in
 * one session must not change any other open session. The previous key
 * (`hermes.session.planMode`) was global, so turning PLAN on leaked into every
 * other session and every new one — the user had to switch each back manually.
 *
 * Keys are namespaced by the session the mode belongs to. `runKey` is used
 * before a session id exists (a brand-new chat has none until its first turn),
 * so a draft conversation keeps its own mode and carries it over on promotion.
 */

const PLAN_MODE_PREFIX = "hermes.session.planMode.";

/** Key for a conversation that already has a session id. */
export function planModeKey(sessionId: string): string {
  return `${PLAN_MODE_PREFIX}${sessionId}`;
}

/**
 * Read the stored mode for a conversation identity. `identity` is the session
 * id when known, else the run id (new/draft chat).
 */
export function readPlanMode(identity: string | null | undefined): boolean {
  if (!identity) return false;
  try {
    return localStorage.getItem(planModeKey(identity)) === "true";
  } catch {
    return false;
  }
}

/** Persist the mode for a conversation identity. */
export function writePlanMode(
  identity: string | null | undefined,
  value: boolean,
): void {
  if (!identity) return;
  try {
    localStorage.setItem(planModeKey(identity), String(value));
  } catch {
    /* storage unavailable — the in-memory state still applies */
  }
}

/**
 * Move a draft's mode onto its newly-assigned session id, so the choice made
 * before the first send survives the promotion from run-scoped to session-scoped
 * identity. Clears the draft key to avoid leaking it into a later scratch chat
 * that reuses the same run id.
 */
export function migratePlanMode(
  fromIdentity: string | null | undefined,
  toIdentity: string | null | undefined,
): void {
  if (!fromIdentity || !toIdentity || fromIdentity === toIdentity) return;
  try {
    const raw = localStorage.getItem(planModeKey(fromIdentity));
    if (raw === null) return;
    localStorage.setItem(planModeKey(toIdentity), raw);
    localStorage.removeItem(planModeKey(fromIdentity));
  } catch {
    /* ignore */
  }
}
