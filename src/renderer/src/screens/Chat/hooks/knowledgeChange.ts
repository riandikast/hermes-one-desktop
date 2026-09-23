/**
 * Tracks the knowledge-bundle set a live runtime session was seeded with, so a
 * mid-session toggle can mark that session stale.
 *
 * Why this exists: the knowledge index is injected ONCE, through
 * `session.create`'s seed (`ensureRuntimeSessionUnlocked` → `knowledgeIndex`).
 * `prompt.submit` has no per-turn instructions channel, and the gateway ignores
 * a re-seeded index on `session.resume` for an existing stored session. So
 * without this, toggling a bundle on mid-conversation updates a ref nobody
 * reads again and the agent never learns about the bundle.
 *
 * Marking the runtime stale makes the NEXT prompt rebuild it (the transport's
 * existing `recreateRuntimeSessionRef` path, which closes the old runtime and
 * resumes the SAME stored session — no new sidebar row).
 */

/** Stable, order-independent key for a bundle set. */
export function knowledgeKey(bundles: readonly string[] | undefined): string {
  return [...new Set((bundles ?? []).map((b) => b.trim()).filter(Boolean))]
    .sort()
    .join("\u0000");
}

export interface KnowledgeChange {
  /** Bundles the live session was seeded with. */
  previous: string[];
  /** Bundles now selected. */
  next: string[];
  /** Human-readable summary: what the agent gains on the next prompt. */
  summary: string;
}

function describeChange(previous: string[], next: string[]): string {
  const before = new Set(previous);
  const after = new Set(next);
  const added = next.filter((b) => !before.has(b));
  const removed = previous.filter((b) => !after.has(b));

  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`enabled ${added.map((b) => `“${b}”`).join(", ")}`);
  }
  if (removed.length > 0) {
    parts.push(`disabled ${removed.map((b) => `“${b}”`).join(", ")}`);
  }
  return parts.join(" and ");
}

/**
 * Decide whether a bundle-set change needs the runtime rebuilt.
 *
 * Returns null when nothing meaningful changed (key identical), so callers can
 * safely invoke this on every render/toggle without churn.
 */
export function knowledgeChange(
  seeded: readonly string[] | undefined,
  next: readonly string[] | undefined,
): KnowledgeChange | null {
  if (knowledgeKey(seeded) === knowledgeKey(next)) return null;
  const previous = [...(seeded ?? [])];
  const now = [...(next ?? [])];
  return {
    previous,
    next: now,
    summary: describeChange(previous, now),
  };
}

/** The one-line notice shown in the transcript when knowledge changes mid-session. */
export function knowledgeChangeNotice(summary: string): string {
  return (
    `Knowledge updated — ${summary}. ` +
    "The change applies from your next message: the session context is being rebuilt so the agent sees it."
  );
}
