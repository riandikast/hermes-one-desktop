import type { ChatMessage } from "./types";

/**
 * Fork-local render weights — same budget currency as the official desktop's
 * `messagePaintWeight`, but computed from the fork's `ChatMessage` shape
 * (string content + kind variants + attachments + fileChanges).
 *
 * What a turn mounts is what we charge; a collapsed tool row is one line, an
 * image card is a fixed surface, and a fenced diff scales with its payload.
 * Settled runs collapse to COUNT lines; fenced fences are height-capped via
 * visible characters. See `apps/desktop/src/lib/render-weight.ts`.
 */

export const RENDER_WEIGHT_CHARS = 512;
const MAX_MEASURED_MESSAGE_CHARS = 300 * RENDER_WEIGHT_CHARS;
const COLLAPSED_ROW_WEIGHT = 1;
const CARD_WEIGHT = 6;
const paintWeightCache = new WeakMap<object, number>();

function charCost(chars: number): number {
  return 1 + Math.ceil(chars / RENDER_WEIGHT_CHARS);
}

function measureString(content: string, remaining: { value: number }): number {
  const chars = Math.min(content.length, remaining.value);
  remaining.value -= chars;
  return charCost(chars);
}

function messagePaintWeightFork(msg: ChatMessage, remaining: { value: number }): number {
  const kind = (msg as unknown as { kind?: string }).kind;
  if (kind === "reasoning" || kind === "tool_call" || kind === "tool_result") return COLLAPSED_ROW_WEIGHT;
  if (kind === "clarify") return 3;
  if (kind === "file_changes") return CARD_WEIGHT;
  const content = (msg as unknown as { content?: string }).content ?? "";
  const attachCount = (msg as unknown as { attachments?: unknown[] }).attachments?.length ?? 0;
  const weight = measureString(content, remaining) + attachCount * 2;
  return Math.max(1, Math.min(weight, 120));
}

export function forkMessagePaintWeight(msg: ChatMessage, remaining: { value: number }): number {
  const cached = paintWeightCache.get(msg as unknown as object);
  if (cached !== undefined) return cached;
  const w = messagePaintWeightFork(msg, remaining);
  paintWeightCache.set(msg as unknown as object, w);
  return w;
}

export function forkTranscriptWeight(
  messages: readonly ChatMessage[],
): number[] {
  const weights: number[] = new Array(messages.length);
  const remaining = { value: MAX_MEASURED_MESSAGE_CHARS };
  for (let i = 0; i < messages.length; i++) {
    weights[i] = forkMessagePaintWeight(messages[i], remaining);
  }
  return weights;
}
