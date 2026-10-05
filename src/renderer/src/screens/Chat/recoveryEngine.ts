/**
 * Automatic recovery for a turn that fails or wedges.
 *
 * The rule, in plain terms:
 *   - A turn that fails gets retried          2 times PER MODEL
 *   - After those 2 tries, or when a SUBAGENT wedges (running but not
 *     progressing), move to the next model in the fallback chain
 *   - Every attempt re-sends the original prompt with a "Continue." preamble
 *   - NEVER recover from a manual interrupt, and never while a child is
 *     still making progress (that would interrupt healthy work)
 *   - Hard cap on total attempts, so a dead chain cannot loop forever
 *
 * Everything here is pure: it decides WHAT to do from an explicit state, so the
 * rules can be tested exhaustively without a gateway, a gateway failure, or a
 * real wedged subagent. The caller owns the effects (switching the model,
 * sending the prompt).
 */

import type { FallbackModel } from "./fallbackModels";

/** Tries on ONE model before moving on, per the agreed rule. */
export const TRIES_PER_MODEL = 2;
/** Hard cap on total sends for a single turn's recovery. */
export const MAX_TOTAL_ATTEMPTS = 6;
/** Original prompt is truncated in the recovery text so a huge prompt does not
 *  balloon every retry. */
export const RECOVERY_PROMPT_MAX = 1500;

export interface RecoveryState {
  /** Attempts already made for the CURRENT turn (resets per turn). */
  attempts: number;
  /** Index into the chain of the model currently in use. 0 = primary. */
  chainIndex: number;
  /** True once the user interrupted — latches off all recovery. */
  userCancelled: boolean;
  /** True when recovery already fired for THIS stuck episode. */
  firedForEpisode: boolean;
}

export function initialRecoveryState(): RecoveryState {
  return {
    attempts: 0,
    chainIndex: 0,
    userCancelled: false,
    firedForEpisode: false,
  };
}

/**
 * The one-line notice shown in the transcript when auto-recovery acts.
 *
 * Auto-recovery is never silent: a model that changes underneath the user
 * without a word is indistinguishable from a bug, so every step says what it
 * did and how many tries are left.
 */
export function recoveryNoticeMessage(notice: {
  kind: "retried" | "switched";
  attempt?: number;
  model?: string;
}): string {
  if (notice.kind === "switched") {
    return (
      `No response — switching to fallback model “${notice.model ?? "next in list"}” ` +
      "and continuing the prompt automatically."
    );
  }
  return (
    `No response — retrying (attempt ${notice.attempt ?? 1} of ` +
    `${MAX_TOTAL_ATTEMPTS}).`
  );
}

export type RecoveryAction =
  | { kind: "retry-same-model"; attempt: number }
  | { kind: "switch-model"; attempt: number; model: FallbackModel }
  | { kind: "give-up"; reason: "cancelled" | "exhausted" | "no-fallbacks" };

export interface RecoveryInput {
  state: RecoveryState;
  /** The fallback chain, in order (primary already excluded by the caller). */
  chain: FallbackModel[];
  /**
   * True when the trigger was a wedged (non-progressing) subagent rather than a
   * plain turn failure. A wedge skips straight to the next model: the current
   * model is not erroring, it is stuck, so retrying it wastes another timeout.
   */
  fromWedge?: boolean;
}

/**
 * Decide the next recovery step. Returns `give-up` for every terminal case so
 * the caller always has something to surface — never a silent stop.
 */
export function nextRecoveryAction(input: RecoveryInput): RecoveryAction {
  const { state, chain, fromWedge = false } = input;

  // A manual interrupt ends recovery for good. Checked FIRST so no other rule
  // can resurrect it — this is the "app must never type on my behalf after I
  // press stop" guarantee.
  if (state.userCancelled) return { kind: "give-up", reason: "cancelled" };

  if (state.attempts >= MAX_TOTAL_ATTEMPTS) {
    return { kind: "give-up", reason: "exhausted" };
  }

  const attempt = state.attempts + 1;

  // The model in use right now. `chainIndex` 0 is the PRIMARY (not in the
  // chain); 1..n index the chain. If the index has run past the chain, there is
  // nothing left to retry OR switch to — give up rather than "retry" a model
  // that no longer exists.
  const onPrimary = state.chainIndex === 0;
  if (!onPrimary && state.chainIndex > chain.length) {
    return { kind: "give-up", reason: "no-fallbacks" };
  }
  // Tries already used on the CURRENT model.
  const triesOnThisModel = onPrimary
    ? state.attempts
    : state.attempts - state.chainIndex * TRIES_PER_MODEL;

  // Still has a try left on this model — but a wedge means the model is stuck,
  // not erroring, so move on rather than serve another timeout.
  const wantsSameModel = triesOnThisModel < TRIES_PER_MODEL && !fromWedge;
  if (wantsSameModel) return { kind: "retry-same-model", attempt };

  const next = chain[state.chainIndex];
  if (!next) return { kind: "give-up", reason: "no-fallbacks" };
  return { kind: "switch-model", attempt, model: next };
}

/**
 * The text sent on every recovery attempt.
 *
 * Carries BOTH the instruction and the original prompt: a failure can leave the
 * transcript empty (send refused — "Continue" alone would mean nothing) or
 * half-done (stream died — re-sending only the prompt would redo work). Sending
 * both covers either case, which is why it is not just "Continue".
 */
export function buildRecoveryPrompt(originalPrompt: string): string {
  const original = String(originalPrompt ?? "").trim();
  if (!original) return "Continue.";
  const capped =
    original.length > RECOVERY_PROMPT_MAX
      ? `${original.slice(0, RECOVERY_PROMPT_MAX)}\n\n[...original prompt truncated...]`
      : original;
  return `Continue. Original prompt: ${capped}`;
}

/** A child that has not changed its tool/count for this long is wedged. */
export const SUBAGENT_NO_PROGRESS_MS = 90_000;
/** ...and only after running at least this long, so a slow start is not a wedge. */
export const SUBAGENT_MIN_RUN_MS = 5 * 60_000;

export interface SubagentProgressSample {
  /** Stable identity of the child. */
  id: string;
  /** epoch ms it started, when known. */
  startedAt?: number;
  /** Its tool counter — the progress signal. */
  toolCount?: number;
  lastTool?: string;
}

export interface SubagentWatch {
  /** id → { toolCount, lastTool, lastChangedAt } for the child being tracked. */
  tracked: Map<
    string,
    { toolCount?: number; lastTool?: string; lastChangedAt: number }
  >;
}

export function initialSubagentWatch(): SubagentWatch {
  return { tracked: new Map() };
}

/**
 * Feed the current roster; returns true when a child is WEDGED.
 *
 * Wedged means ALL of:
 *   - it has been running longer than SUBAGENT_MIN_RUN_MS, AND
 *   - its progress signal (toolCount / lastTool) has not changed for
 *     SUBAGENT_NO_PROGRESS_MS.
 *
 * Time alone is not enough: a subagent doing a 10-minute build is healthy and
 * must NOT be interrupted. No-progress alone is not enough either: a child that
 * just started has not had time to make progress yet.
 */
export function detectWedgedSubagent(
  watch: SubagentWatch,
  children: ReadonlyArray<SubagentProgressSample>,
  now: number,
): boolean {
  const seen = new Set<string>();
  let wedged = false;

  for (const child of children) {
    seen.add(child.id);
    const previous = watch.tracked.get(child.id);
    const progressed =
      !previous ||
      previous.toolCount !== child.toolCount ||
      previous.lastTool !== child.lastTool;

    const entry = progressed
      ? { toolCount: child.toolCount, lastTool: child.lastTool, lastChangedAt: now }
      : previous;
    watch.tracked.set(child.id, entry);

    // `startedAt` may legitimately be 0, so test for presence, not truthiness.
    const runningFor =
      typeof child.startedAt === "number" ? now - child.startedAt : 0;
    const quietFor = now - entry.lastChangedAt;
    if (
      runningFor >= SUBAGENT_MIN_RUN_MS &&
      quietFor >= SUBAGENT_NO_PROGRESS_MS
    ) {
      wedged = true;
    }
  }

  // Drop children no longer in the roster, so a finished child's stale
  // timestamp cannot later read as "quiet for a long time".
  for (const id of Array.from(watch.tracked.keys())) {
    if (!seen.has(id)) watch.tracked.delete(id);
  }

  return wedged;
}
