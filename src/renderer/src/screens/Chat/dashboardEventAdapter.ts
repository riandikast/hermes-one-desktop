import type { ChatToolEvent } from "../../../../shared/chat-stream";
import { countDiffLineStats, inlineDiffFromPayload } from "./diffLines";
import { isLossyChunkCopy } from "./lossyText";
import type { ActiveTurn, ChatBubbleMessage, ChatMessage } from "./types";

export interface DashboardStreamEvent<T = unknown> {
  payload?: T;
  session_id?: string;
  type: string;
}

export interface DashboardEventState {
  messages: ChatMessage[];
  reasoningSegmentClosed: boolean;
}

/** Tool names that mutate files — captured for the file-changes summary.
 *  Includes command-executors (terminal/process/bash/…) because write tools
 *  vary by gateway; the real filter is the absolute path found in args. */
export const WRITE_TOOL_NAMES = [
  "write_file",
  "edit_file",
  "patch_file",
  "create_file",
  "delete_file",
  "move_file",
  "copy_file",
  "rename_file",
  "apply_patch",
  "str_replace",
  "save_file",
  "patch",
  "edit",
  "replace",
  "remove",
  "update",
  "terminal",
  "process",
  "bash",
  "shell",
  "exec",
  "run_command",
  "execute_code",
  "execute",
  "mkdir",
  "rm",
  "mv",
  "cp",
];

interface ApplyDashboardEventOptions {
  activeTurn?: ActiveTurn | null;
  now?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

const THINKING_STATUS_PREFIX_RE =
  /^\s*(?:(?:[^\s.]{1,16})\s+)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i;

const EMPTY_THINKING_PLACEHOLDER_RE =
  /\b(?:current rewritten thinking|next thinking to process|provide the thinking content|don't see any .*thinking)\b/i;

function coerceGatewayText(value: unknown): string {
  const direct = stringValue(value);
  if (direct) return direct;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isRecord(item)) return "";
        return stringValue(item.text) || stringValue(item.output_text);
      })
      .join("");
  }
  if (isRecord(value)) {
    return stringValue(value.text) || stringValue(value.output_text);
  }
  return String(value);
}

function coerceThinkingText(value: unknown): string {
  const raw = coerceGatewayText(value).replace(THINKING_STATUS_PREFIX_RE, "");
  return EMPTY_THINKING_PLACEHOLDER_RE.test(raw) ? "" : raw;
}

function textFromPayload(payload: unknown, ...keys: string[]): string {
  if (!isRecord(payload)) return "";
  for (const key of keys) {
    const value = coerceGatewayText(payload[key]);
    if (value) return value;
  }
  return "";
}

function thinkingTextFromPayload(payload: unknown, ...keys: string[]): string {
  if (!isRecord(payload)) return "";
  for (const key of keys) {
    const value = coerceThinkingText(payload[key]);
    if (value) return value;
  }
  return "";
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function previewFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const direct = textFromPayload(
    payload,
    "preview",
    "label",
    "command",
    "context",
    "message",
  );
  if (direct) return direct;
  return (
    stableStringify(payload.args) ||
    stableStringify(payload.input) ||
    stableStringify(payload.arguments)
  );
}

function resultFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const result =
    stableStringify(payload.result) ||
    stableStringify(payload.output) ||
    stableStringify(payload.content) ||
    textFromPayload(payload, "text");
  const error = stableStringify(payload.error);
  if (error && result) return `${result}\n\n${error}`;
  return error || result;
}

function appendClarifyRequest(
  messages: ReadonlyArray<ChatMessage>,
  payload: unknown,
  now = Date.now(),
): ChatMessage[] {
  if (!isRecord(payload)) return [...messages];
  const requestId = textFromPayload(payload, "request_id", "id");
  const question = textFromPayload(payload, "question", "message", "text");
  if (!question.trim()) return [...messages];

  const choices = Array.isArray(payload.choices)
    ? payload.choices
        .map((choice) => stringValue(choice))
        .filter((choice) => choice.trim())
    : [];
  const content =
    choices.length > 0
      ? `${question}\n\n${choices
          .map((choice, index) => `${index + 1}. ${choice}`)
          .join("\n")}`
      : question;
  const id = `clarify-${requestId || `${now}-${messages.length}`}`;
  const existingIndex = messages.findIndex((message) => message.id === id);
  const bubble: ChatBubbleMessage = {
    id,
    role: "agent",
    content,
    pending: false,
    localOnly: true,
  };
  if (existingIndex >= 0) {
    return [
      ...messages.slice(0, existingIndex),
      bubble,
      ...messages.slice(existingIndex + 1),
    ];
  }
  return [...messages, bubble];
}

function toolEventFromGatewayEvent(event: DashboardStreamEvent): ChatToolEvent {
  const payload = isRecord(event.payload) ? event.payload : {};
  const name =
    textFromPayload(payload, "name", "tool", "function", "function_name") ||
    "tool";
  const callId =
    textFromPayload(payload, "tool_id", "tool_call_id", "callId", "id") ||
    `${name}:${previewFromPayload(payload) || event.type}`;
  const complete = event.type === "tool.complete";
  const failed = !!payload.error || stringValue(payload.status) === "failed";
  const status = complete ? (failed ? "failed" : "completed") : "running";
  const label = previewFromPayload(payload);
  const result = complete ? resultFromPayload(payload) : "";

  // Authoritative file-edit diff from the backend (tool.complete
  // inline_diff) — attached to the result row so the UI can render the
  // per-edit card with +N −M counts.
  const inlineDiff = complete ? inlineDiffFromPayload(payload) : null;
  let diff: string | undefined;
  let added: number | undefined;
  let removed: number | undefined;
  if (inlineDiff) {
    diff = inlineDiff;
    const stats = countDiffLineStats(inlineDiff);
    added = stats.added;
    removed = stats.removed;
  }

  return {
    callId,
    hasStableCallId: !!textFromPayload(
      payload,
      "tool_id",
      "tool_call_id",
      "callId",
      "id",
    ),
    name,
    status,
    ...(label ? { label, preview: label } : {}),
    ...(result ? { result } : {}),
    ...(diff ? { diff, added, removed } : {}),
  };
}

function isAssistantBubble(msg: ChatMessage): msg is ChatBubbleMessage {
  const kind = (msg as { kind?: string }).kind;
  return msg.role === "agent" && (!kind || kind === "assistant");
}

/** Tool rows are hard segment boundaries: reasoning/answer after a tool is a
 *  new row, never a merge across the tool. */
function isToolRow(msg: ChatMessage): boolean {
  const kind = (msg as { kind?: string }).kind;
  return kind === "tool_call" || kind === "tool_result";
}

function appendAssistantDelta(
  messages: ReadonlyArray<ChatMessage>,
  chunk: string,
  activeTurn?: ActiveTurn | null,
  now = Date.now(),
): ChatMessage[] {
  if (!chunk) return [...messages];
  // Merge into the LAST assistant bubble of the current turn, even when it is
  // not the trailing row (thinking/tool deltas interleave after the answer
  // started). Appending a fresh bubble per delta remounts the row and replays
  // its entry animation (a visible blink on every chunk), and stacks answer
  // text below the thinking rows. The scan deliberately crosses tool rows:
  // a model that answers → runs a tool → answers again must continue the SAME
  // bubble (message.complete merges pre/post-tool text into one bubble too),
  // not spawn a new one that blinks in mid-turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (
      isAssistantBubble(msg) &&
      !msg.error &&
      (!activeTurn || !msg.turnId || msg.turnId === activeTurn.turnId)
    ) {
      return [
        ...messages.slice(0, i),
        {
          ...msg,
          content: msg.content + chunk,
          pending: true,
          turnId: msg.turnId || activeTurn?.turnId,
        },
        ...messages.slice(i + 1),
      ];
    }
  }

  return [
    ...messages,
    {
      id: `agent-dashboard-${now}-${messages.length}`,
      role: "agent",
      content: chunk,
      pending: true,
      ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
    },
  ];
}

function appendReasoningDelta(
  messages: ReadonlyArray<ChatMessage>,
  chunk: string,
  forceNewSegment: boolean,
  now = Date.now(),
): ChatMessage[] {
  if (!chunk) return [...messages];
  // Merge into the LAST reasoning row of the current turn, even when it is
  // not the trailing row (ANSWER deltas interleave while thinking is still
  // streaming). Appending a fresh row per delta remounts the reasoning
  // container and replays its entry animation (a visible blink per chunk),
  // and stacks thinking below the answer.
  //
  // A TOOL row is a hard boundary: the model finished thinking, ran a tool,
  // and a later thinking chunk is a NEW segment. Stopping the backward scan
  // at tool rows keeps interleaved-answer merges while preserving that.
  if (!forceNewSegment) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") break;
      if (isToolRow(msg)) break;
      if (msg.role === "agent" && "kind" in msg && msg.kind === "reasoning") {
        return [
          ...messages.slice(0, i),
          {
            ...msg,
            text: msg.text + chunk,
          },
          ...messages.slice(i + 1),
        ];
      }
    }
  }

  // Late reasoning (delivered after the answer started streaming) must land
  // ABOVE the answer bubble it belongs to — appending below stacks thinking
  // under the answer and pops the row in with a visible entry-animation
  // blink. Mirror the legacy `liveReasoningEvents` insert logic, scoped to
  // the current turn so a trailing bubble from a previous turn isn't
  // mistaken for the current answer.
  const last = messages[messages.length - 1];
  const turnStart = findLastUserIndex(messages) + 1;
  const insertAt =
    messages.length > turnStart && last && isAssistantBubble(last)
      ? messages.length - 1
      : messages.length;

  return [
    ...messages.slice(0, insertAt),
    {
      id: `reasoning-dashboard-${now}-${messages.length}`,
      kind: "reasoning",
      role: "agent",
      text: chunk,
    },
    ...messages.slice(insertAt),
  ];
}

function findToolCallIndex(
  messages: ReadonlyArray<ChatMessage>,
  callId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if ("kind" in msg && msg.kind === "tool_call" && msg.callId === callId) {
      return i;
    }
  }
  return -1;
}

function hasMatchingToolResult(
  messages: ReadonlyArray<ChatMessage>,
  callId: string,
  content: string,
): boolean {
  return messages.some(
    (msg) =>
      "kind" in msg &&
      msg.kind === "tool_result" &&
      msg.callId === callId &&
      msg.content === content,
  );
}

function appendToolEvent(
  messages: ReadonlyArray<ChatMessage>,
  event: ChatToolEvent,
): ChatMessage[] {
  const detail = event.preview || event.label || "";
  if (
    event.status === "running" &&
    event.hasStableCallId === false &&
    !detail.trim()
  ) {
    return [...messages];
  }

  const toolIndex = findToolCallIndex(messages, event.callId);
  const next = [...messages];

  if (toolIndex >= 0) {
    const current = next[toolIndex];
    if ("kind" in current && current.kind === "tool_call") {
      next[toolIndex] = {
        ...current,
        name: event.name || current.name,
        args: detail || current.args,
        status: event.status,
      };
    }
  } else {
    next.push({
      id: `tool-call-${event.callId}`,
      kind: "tool_call",
      role: "agent",
      callId: event.callId,
      name: event.name || "tool",
      args: detail,
      status: event.status,
    });
  }

  if (event.result) {
    if (hasMatchingToolResult(next, event.callId, event.result)) {
      return next;
    }
    next.push({
      id: `tool-result-${event.callId}-${next.length}`,
      kind: "tool_result",
      role: "agent",
      callId: event.callId,
      name: event.name || "tool",
      content: event.result,
    });
  }

  return next;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Length of the longest suffix of `a` that is also a prefix of `b`, used to
 * stitch a re-streamed boundary without duplicating the shared run. The
 * overlap is rejected when it would splice the middle of a word on either
 * side (e.g. `"…worl" + "d…"`), so a coincidental shared character isn't
 * treated as a real seam. Punctuation and whitespace are valid seams.
 */
function commonSuffixLength(a: string, b: string): number {
  let i = a.length - 1;
  let j = b.length - 1;
  let n = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    i--;
    j--;
    n++;
  }
  return n;
}

function tailHeadOverlap(a: string, b: string): number {
  const word = /\w/;
  const max = Math.min(a.length, b.length);
  for (let k = max; k > 0; k--) {
    if (!a.endsWith(b.slice(0, k))) continue;
    const aStart = a.length - k;
    const startsMidWord =
      aStart > 0 && word.test(a[aStart - 1]) && word.test(a[aStart]);
    const endsMidWord = k < b.length && word.test(b[k - 1]) && word.test(b[k]);
    if (!startsMidWord && !endsMidWord) return k;
  }
  return 0;
}

/**
 * Reconcile the text accumulated from streamed `message.delta` chunks with the
 * `final_response` delivered on `message.complete`.
 *
 * The streamed bubble can hold text produced *before* a tool call, while
 * `final_response` may carry only the last turn's text — so blindly
 * overwriting with the final text drops the pre-tool-call content (#746).
 * Other times the final text is the fuller version. Resolve both:
 *   - empty streamed   → final (the remote path never renders deltas, so the
 *                        bubble starts empty and final is all we have)
 *   - final ⊇ streamed → final
 *   - streamed ⊇ final → streamed (keeps the pre-tool-call text)
 *   - tail/head overlap → stitch, dropping the duplicated seam
 *   - otherwise        → concatenate with a blank-line separator so the two
 *                        segments don't run together ("check.It's" / "4answer")
 *
 * Comparison is whitespace-insensitive; every branch returns trimmed text so
 * the result doesn't depend on which branch ran.
 */
export function mergeStreamedWithFinal(
  streamed: string,
  final: string,
): string {
  const streamedContent = streamed.trim();
  const finalContent = final.trim();
  if (!streamedContent) return finalContent;
  if (!finalContent) return streamedContent;

  const normStreamed = normalizeText(streamedContent);
  const normFinal = normalizeText(finalContent);
  if (normFinal.includes(normStreamed)) return finalContent;
  if (normStreamed.includes(normFinal)) return streamedContent;

  // Lossy re-assembly: the streamed deltas dropped chunks (e.g. the upstream
  // tagged alternate chunks as `reasoning`, so the content stream only carried
  // a subset), leaving the streamed bubble a chunk-dropped copy of the final
  // text ("! What are we working on?" for "Hey! What are we working on
  // today?"). Concatenating would stack the garbled partial above the clean
  // answer — the final text replaces it. The run-based matcher plus its
  // length/coverage guards keep the pre-tool-call + answer pair (#746,
  // genuinely different texts) on the concatenate path: unrelated sentences
  // only embed as scattered fragments, never as contiguous chunk runs.
  if (isLossyChunkCopy(normStreamed, normFinal)) {
    return finalContent;
  }

  const overlap = tailHeadOverlap(streamedContent, finalContent);
  if (overlap > 0) return `${streamedContent}${finalContent.slice(overlap)}`;

  // A re-streamed correction: the streamed deltas were garbled (e.g. a
  // corrupted CJK prefix) but converged on the same ending as the final text.
  // When the two share a substantial common tail they are the *same* sentence,
  // not the pre-tool-call + answer pair that the concatenate branch handles —
  // so the clean final replaces the garbled stream instead of stacking a near
  // duplicate above it.
  const suffix = commonSuffixLength(streamedContent, finalContent);
  if (suffix > 0) {
    const shared = finalContent.slice(finalContent.length - suffix);
    const meaningful = shared.replace(/[\s\p{P}]/gu, "").length;
    const shorter = Math.min(streamedContent.length, finalContent.length);
    if (meaningful >= 3 && suffix / shorter >= 0.5) return finalContent;
  }

  return `${streamedContent}\n\n${finalContent}`;
}

function findLastUserIndex(messages: ReadonlyArray<ChatMessage>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function hasReasoningSinceLastUser(
  messages: ReadonlyArray<ChatMessage>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if ("kind" in msg && msg.kind === "reasoning" && normalizeText(msg.text)) {
      return true;
    }
  }
  return false;
}

function addCompletionReasoningFallback(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  reasoningText: string,
  now = Date.now(),
): ChatMessage[] {
  const reasoning = normalizeText(reasoningText);
  if (!reasoning || hasReasoningSinceLastUser(messages)) return [...messages];

  const final = normalizeText(finalText);
  if (final && (final.startsWith(reasoning) || reasoning.startsWith(final))) {
    return [...messages];
  }

  const reasoningRow: ChatMessage = {
    id: `reasoning-dashboard-${now}-${messages.length}`,
    kind: "reasoning",
    role: "agent",
    text: reasoningText,
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break;
    if (isAssistantBubble(msg)) {
      return [...messages.slice(0, i), reasoningRow, ...messages.slice(i)];
    }
  }

  return [...messages, reasoningRow];
}

/**
 * Official stability contract (merged from the upstream desktop's
 * `mergeFinalAssistantText`), with one fork for OUR backend's behavior:
 *
 * - When the authoritative final text COVERS the turn's streamed text
 *   (normalized includes), the official contract applies: EVERY streamed
 *   text bubble of the turn is discarded and replaced by ONE authoritative
 *   final bubble; reasoning rows fully covered by the final are dropped
 *   too. This is what makes the live stream stable — the final always
 *   wins, so dropped/garbled delta chunks can never corrupt the answer.
 * - When the final is LAST-TURN-ONLY (a strict subset — our backend can
 *   deliver `final_response` that omits pre-tool-call text, #746), the
 *   streamed bubble is kept and merged with the final via the legacy
 *   `mergeStreamedWithFinal` reconciliation instead of being erased.
 * - An empty final leaves the streamed bubble untouched (pending stays
 *   true — `session.info running:false` settles it).
 */
export function mergeFinalAssistantText(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  turnId?: string | null,
  now = Date.now(),
): ChatMessage[] {
  const final = finalText.trim();
  if (!final) return [...messages];

  const normFinal = normalizeText(final);
  // The turn's streamed rows are those AFTER the last user row — the
  // positional boundary, not turnId presence: bubbles loaded from state.db
  // (reopened/resumed sessions) carry no turnId, and a merge scoped by
  // "no turnId matches anything" would concatenate EVERY answer in the
  // session into the last bubble. turnId is a secondary, position-anchored
  // filter for live bubbles that carry it.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const inCurrentTurn = (msg: ChatMessage): boolean =>
    !("kind" in msg) || (msg.kind !== "file_changes" && msg.kind !== "clarify");

  // Streamed text of this turn = concatenation of its assistant bubbles.
  const streamedBubbles = messages.filter(
    (msg, index) =>
      index > lastUserIdx &&
      inCurrentTurn(msg) &&
      msg.role === "agent" &&
      isAssistantBubble(msg),
  );
  const streamedText = streamedBubbles
    .map((m) => (m as ChatBubbleMessage).content ?? "")
    .join("");
  const normStreamed = normalizeText(streamedText);

  if (normStreamed && !normFinal.includes(normStreamed)) {
    // Final is last-turn-only: keep the streamed bubble (pre-tool-call
    // text) and merge the final into it (#746). Reuse the legacy
    // reconciliation (which also handles lossy chunk-dropped streams).
    const merged = mergeStreamedWithFinal(streamedText, final);
    const lastBubble = streamedBubbles[streamedBubbles.length - 1];
    const lastBubbleMsg = lastBubble as ChatBubbleMessage;
    return messages.map((msg) =>
      msg === lastBubble
        ? {
            ...msg,
            content: merged,
            pending: false,
            turnId: lastBubbleMsg.turnId || (turnId ?? undefined),
          }
        : msg,
    );
  }

  // Official contract: drop every streamed text bubble + reasoning fully
  // covered by the final; append ONE authoritative final bubble.
  const filtered = messages.filter((msg, index) => {
    // Keep everything before the turn boundary (prior turns, user rows).
    if (index <= lastUserIdx) return true;
    if (msg.role === "agent" && isAssistantBubble(msg)) {
      // All streamed text bubbles of this turn are removed.
      return false;
    }
    if ("kind" in msg && msg.kind === "reasoning") {
      const reasoning = normalizeText(msg.text);
      if (reasoning && normFinal.startsWith(reasoning)) return false;
    }
    return true;
  });

  return [
    ...filtered,
    {
      id: `agent-dashboard-${now}-${messages.length}`,
      role: "agent",
      content: final,
      pending: false,
      ...(turnId ? { turnId } : {}),
    },
  ];
}

/**
 * Settle stranded pending bubbles when a turn ends without `message.complete`
 * (official `finalizeInterruptedMessages` equivalent — triggered by
 * `session.info running:false`). Empty placeholders are dropped; pending
 * bubbles that accumulated text are un-pended and kept.
 */
export function finalizeInterruptedMessages(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "agent" && isAssistantBubble(msg) && msg.pending) {
      if (!(msg.content ?? "").trim()) continue; // drop empty placeholder
      out.push({ ...msg, pending: false });
      continue;
    }
    out.push(msg);
  }
  return out;
}

export function applyDashboardStreamEvent(
  state: DashboardEventState,
  event: DashboardStreamEvent,
  options: ApplyDashboardEventOptions = {},
): DashboardEventState {
  const now = options.now ?? Date.now();
  switch (event.type) {
    case "message.start":
      return { ...state, reasoningSegmentClosed: false };
    case "message.delta":
      return {
        messages: appendAssistantDelta(
          state.messages,
          textFromPayload(event.payload, "text", "delta"),
          options.activeTurn,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    case "thinking.delta":
      return {
        messages: appendReasoningDelta(
          state.messages,
          thinkingTextFromPayload(event.payload, "text", "delta", "reasoning"),
          state.reasoningSegmentClosed,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    case "reasoning.delta":
      return {
        messages: appendReasoningDelta(
          state.messages,
          thinkingTextFromPayload(event.payload, "text", "delta", "reasoning"),
          state.reasoningSegmentClosed,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    // `reasoning.available` is a post-hoc preview signal that on some
    // transports/providers carries the full visible assistant text rather than
    // private reasoning. Injecting it as a "Thought" duplicates the response,
    // so it is ignored entirely; canonical reasoning comes from the streamed
    // `reasoning.delta` chunks (and the DB reconciliation path).
    case "reasoning.available":
      return state;
    case "tool.start":
    case "tool.progress":
    case "tool.generating":
    case "tool.complete":
      return {
        messages: appendToolEvent(
          state.messages,
          toolEventFromGatewayEvent(event),
        ),
        reasoningSegmentClosed: true,
      };
    case "clarify.request":
      return {
        messages: appendClarifyRequest(state.messages, event.payload, now),
        reasoningSegmentClosed: true,
      };
    case "message.complete": {
      // The gateway can deliver the final text under several keys depending
      // on transport/version: "text"/"rendered" (streaming completion) or
      // "final_response"/"output_text"/"content" (RPC-style completion).
      // Missing one shape made finalText empty → mergeFinalAssistantText
      // early-returned → NO answer bubble while isLoading still flipped false
      // (chime fires, answer never appears — the intermittent "last answer
      // missing on live" bug).
      const finalText = textFromPayload(
        event.payload,
        "text",
        "rendered",
        "final_response",
        "output_text",
        "content",
      );
      const finalReasoning = thinkingTextFromPayload(
        event.payload,
        "reasoning",
        "thinking",
      );
      const messagesWithReasoning = addCompletionReasoningFallback(
        state.messages,
        finalText,
        finalReasoning,
        now,
      );
      return {
        messages: mergeFinalAssistantText(
          messagesWithReasoning,
          finalText,
          options.activeTurn?.turnId ?? null,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    }
    case "session.info": {
      const payload = isRecord(event.payload) ? event.payload : {};
      if (payload.running === false) {
        return {
          messages: finalizeInterruptedMessages(state.messages),
          reasoningSegmentClosed: state.reasoningSegmentClosed,
        };
      }
      return state;
    }
    default:
      return state;
  }
}
