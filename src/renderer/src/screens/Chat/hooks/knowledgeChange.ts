/** Selection notices only; Knowledge is sent as user data on each outgoing turn. */

/** Stable, order-independent key for a bundle set. */
export function knowledgeKey(bundles: readonly string[] | undefined): string {
  return [...new Set((bundles ?? []).map((b) => b.trim()).filter(Boolean))]
    .sort()
    .join("\u0000");
}

export interface KnowledgeChange {
  /** Previously selected bundles. */
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
 * Describe a bundle-set change without rebuilding the runtime.
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
    "The change applies from your next message. Earlier reference context remains in conversation history."
  );
}
