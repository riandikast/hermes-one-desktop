export interface TranscriptGroup {
  id: string;
  kind: "standalone" | "turn";
  weight: number;
  indices: number[];
}

export const RENDER_BUDGET = 600;
export const MIN_VISIBLE_GROUPS = 8;
export const FIRST_PAINT_BUDGET = 20;
export const LIVE_TAIL_WEIGHT = 40;
export const LIVE_TAIL_MIN_GROUPS = 2;
export const LIVE_TAIL_MAX_GROUPS = 6;

/**
 * Build groups from the fork's linear transcript:
 * each user message + following agent rows = one turn.
 * Matches official `buildGroups` / `firstVisibleGroupIndex` / `liveTailStart`
 * in `apps/desktop/src/components/assistant-ui/thread/list.tsx`.
 */
export function buildTranscriptGroups(
  messages: readonly { id: string; role?: string; kind?: string }[],
  weights: readonly number[],
): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "user") {
      groups.push({ id: m.id, kind: "standalone", weight: weights[i] ?? 1, indices: [i] });
      continue;
    }
    const indices = [i];
    let w = weights[i] ?? 1;
    while (i + 1 < messages.length && (messages[i + 1]!.role as string) !== "user") {
      w += weights[i + 1] ?? 1;
      indices.push(++i);
    }
    groups.push({ id: m.id, kind: "turn", weight: w, indices });
  }
  return groups;
}

export function firstVisibleGroupIndex(
  groups: readonly TranscriptGroup[],
  budget: number,
  minVisible = 0,
): number {
  let first = groups.length;
  for (let i = groups.length - 1, acc = 0; i >= 0; i--) {
    acc += groups[i]!.weight;
    first = i;
    if (acc >= budget) break;
  }
  return Math.min(first, Math.max(0, groups.length - minVisible));
}

export function liveTailStart(
  groups: readonly TranscriptGroup[],
  tailWeight = LIVE_TAIL_WEIGHT,
  minGroups = LIVE_TAIL_MIN_GROUPS,
  maxGroups = LIVE_TAIL_MAX_GROUPS,
): number {
  let acc = 0;
  let start = groups.length;
  for (let i = groups.length - 1; i >= 0; i--) {
    acc += groups[i]!.weight ?? 1;
    start = i;
    if (acc > tailWeight) break;
  }
  const floor = Math.max(0, groups.length - minGroups);
  const ceiling = Math.max(0, groups.length - maxGroups);
  return Math.min(floor, Math.max(ceiling, start));
}
