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
export function readOnFinishSelection(): string[] {
  try {
    const raw = localStorage.getItem(ON_FINISH_SELECTION_KEY);
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

/** Persist the ordered selection, writing explicit indices. */
export function writeOnFinishSelection(ids: readonly string[]): void {
  try {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify(ids.map((id, order) => ({ id, order }))),
    );
  } catch {
    /* storage unavailable — the in-memory state still works for this session */
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
