/**
 * On-Finish: the ordered set of commands that auto-run after an agent turn.
 *
 * TWO independent halves, deliberately decoupled:
 *  - the SELECTION (which commands, and in what order) — persisted here, so it
 *    survives reloads and is editable from the Commands page;
 *  - the ARM flag (whether to actually run on finish) — per chat session, held
 *    in Chat state, because arming is a property of a conversation, not of the
 *    command list.
 *
 * ORDER IS MEANINGFUL: the array order IS the execution order, first-selected
 * runs first. Never model this as a Set — Sets do not preserve insertion order
 * across all operations (delete/re-add moves an item) and the round-trip
 * through JSON would lose it anyway.
 */

export const ON_FINISH_SELECTION_KEY = "hermes.onFinish.selectedCommands";
export const ON_FINISH_ARM_KEY = "hermes.onFinish.armed";

/**
 * Scope for the LEGACY global queue (written before per-session support).
 * Kept as its own scope so an existing user's queue is not silently lost: it
 * is read as the fallback for a session that has never saved its own.
 */
export const ON_FINISH_DEFAULT_SCOPE = "default";

/**
 * Per-session storage keys.
 *
 * Each chat has its OWN ordered queue, keyed by the chat's identity. A session
 * with no saved queue falls back to the legacy unscoped value (see
 * ON_FINISH_DEFAULT_SCOPE) and then to "empty", so upgrading does not wipe
 * whatever was already configured.
 */
function selectionKey(scope: string): string {
  return `${ON_FINISH_SELECTION_KEY}.${scope}`;
}

/**
 * Fired on `window` whenever the ordered selection changes.
 *
 * A `storage` event cannot be used: it only fires in OTHER documents, so a
 * same-page writer (the On-Finish chip) would never notify the chat that owns
 * the auto-run. A CustomEvent keeps the chip and the chat in sync within one
 * renderer while still persisting through localStorage.
 */
export const ON_FINISH_CHANGE_EVENT = "hermes:onFinishChanged";

/** Minimal shape the runner needs; the Commands page passes fuller objects. */
export interface OnFinishCommand {
  id: string;
  command: string;
  cwd?: string;
  name?: string;
}

/**
 * Read the ordered selection.
 *
 * Accepts the legacy/plain-id-array shape as well as `{id, order}` records, and
 * always returns a de-duplicated array in explicit `order` sequence. Anything
 * corrupt is dropped rather than throwing, so a bad value can never break the
 * chatbox on boot.
 */
export function readOnFinishSelection(
  scope: string = ON_FINISH_DEFAULT_SCOPE,
): string[] {
  try {
    // Prefer this session's own queue. Fall back to the legacy global value
    // ONLY when this scope has never been written, so an explicit "no
    // commands" (empty array) is not overridden by stale global state.
    const scoped = localStorage.getItem(selectionKey(scope));
    const raw =
      scoped !== null
        ? scoped
        : scope === ON_FINISH_DEFAULT_SCOPE
          ? localStorage.getItem(ON_FINISH_SELECTION_KEY)
          : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const entries: { id: string; order: number }[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const item = parsed[i];
      if (typeof item === "string") {
        // Bare id: its array position is its order.
        if (item) entries.push({ id: item, order: i });
        continue;
      }
      if (item && typeof item === "object") {
        const rec = item as { id?: unknown; order?: unknown };
        if (typeof rec.id !== "string" || !rec.id) continue;
        entries.push({
          id: rec.id,
          order: typeof rec.order === "number" ? rec.order : i,
        });
      }
    }

    // Explicit order wins; ties fall back to array position (stable).
    entries.sort((a, b) => a.order - b.order);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const { id } of entries) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Move a queue from one identity scope to another.
 *
 * Used when a draft chat (keyed by runId) receives its real session id. The
 * source scope is only removed when the destination did not already have its
 * own queue — otherwise reopening an existing session would clobber its saved
 * queue with a stale draft one.
 */
export function migrateOnFinishSelection(from: string, to: string): void {
  if (from === to) return;
  try {
    if (localStorage.getItem(selectionKey(to)) !== null) return;
    const value = localStorage.getItem(selectionKey(from));
    if (value === null) return;
    localStorage.setItem(selectionKey(to), value);
    localStorage.removeItem(selectionKey(from));
  } catch {
    /* storage unavailable — nothing to migrate */
  }
}

/**
 * Every command id selected in ANY session scope, de-duplicated.
 *
 * The Commands page is a global view of which commands are queued somewhere.
 * With per-session queues a single scope would be misleading — a command ticked
 * in one chat would appear unticked here — so it unions all scopes.
 */
export function readAllOnFinishSelections(): string[] {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isScoped = key.startsWith(`${ON_FINISH_SELECTION_KEY}.`);
      // The unscoped legacy key holds the same shape, without the prefix.
      if (!isScoped && key !== ON_FINISH_SELECTION_KEY) continue;
      const scope = isScoped
        ? key.slice(ON_FINISH_SELECTION_KEY.length + 1)
        : ON_FINISH_DEFAULT_SCOPE;
      for (const id of readOnFinishSelection(scope)) ids.add(id);
    }
  } catch {
    /* storage unavailable — nothing to report */
  }
  return [...ids];
}

/** Persist the ordered selection, writing explicit indices. */
export function writeOnFinishSelection(
  ids: readonly string[],
  scope: string = ON_FINISH_DEFAULT_SCOPE,
): void {
  try {
    localStorage.setItem(
      selectionKey(scope),
      JSON.stringify(ids.map((id, order) => ({ id, order }))),
    );
  } catch {
    /* storage unavailable — the in-memory state still works for this session */
  }
  // Always notify same-page listeners, even when storage failed: the chat must
  // still arm/disarm for this session.
  try {
    window.dispatchEvent(
      new CustomEvent(ON_FINISH_CHANGE_EVENT, { detail: { scope } }),
    );
  } catch {
    /* non-browser environment (tests without jsdom) */
  }
}

/**
 * Toggle one command in/out of the selection.
 *
 * Selecting APPENDS, so the newest pick runs last — that is what makes "the
 * earlier you selected it, the earlier it runs" true. Clicking an already
 * selected command DESELECTS it (checkbox semantics); to change an existing
 * item's position without losing it, use `moveOnFinishSelection`.
 */
export function toggleOnFinishSelection(
  ids: readonly string[],
  id: string,
): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Move a selected command one slot earlier/later. Order is the whole point of
 * this feature, so reordering must be possible without deselect/reselect.
 */
export function moveOnFinishSelection(
  ids: readonly string[],
  id: string,
  delta: number,
): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return [...ids];
  const next = index + delta;
  if (next < 0 || next >= ids.length) return [...ids];
  const copy = [...ids];
  copy.splice(index, 1);
  copy.splice(next, 0, id);
  return copy;
}

/**
 * Order the selection against the live command list and drop ids that no
 * longer exist (a deleted command must not wedge the run loop).
 */
export function resolveOnFinishCommands<T extends { id: string }>(
  selectedIds: readonly string[],
  commands: readonly T[],
): T[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  const out: T[] = [];
  for (const id of selectedIds) {
    const cmd = byId.get(id);
    if (cmd) out.push(cmd);
  }
  return out;
}

/** Arm flag: per-session, so one conversation cannot arm another. */
export function readOnFinishArmed(identity: string): boolean {
  try {
    return localStorage.getItem(`${ON_FINISH_ARM_KEY}.${identity}`) === "true";
  } catch {
    return false;
  }
}

export function writeOnFinishArmed(identity: string, armed: boolean): void {
  try {
    localStorage.setItem(`${ON_FINISH_ARM_KEY}.${identity}`, String(armed));
  } catch {
    /* ignore */
  }
}

/**
 * ARMING IS DERIVED, NOT STORED SEPARATELY.
 *
 * An armed-but-empty queue is unobservable from the chat: the user ticked
 * commands, they remember ticking them, and nothing runs. Deriving the arm
 * state from "is the queue non-empty?" makes that state impossible to express —
 * ticking a command arms, unticking the last one disarms.
 *
 * The identity argument is kept so the arm state stays per-session if a
 * persisted override is ever reintroduced, but it does not gate this.
 */
export function isOnFinishArmed(selectedIds: readonly string[]): boolean {
  return selectedIds.length > 0;
}
