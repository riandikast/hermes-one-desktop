import type { ChatBubbleMessage, ChatMessage, ReasoningMessage } from "./types";

function isAssistantBubble(msg: ChatMessage): msg is ChatBubbleMessage {
  const kind = (msg as { kind?: string }).kind;
  return msg.role === "agent" && (!kind || kind === "assistant");
}

function latestUserIndex(messages: ReadonlyArray<ChatMessage>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

export function upsertLiveReasoningChunk(
  messages: ReadonlyArray<ChatMessage>,
  chunk: string,
  now = Date.now(),
  forceNewSegment = false,
): ChatMessage[] {
  if (!chunk) return [...messages];

  if (!forceNewSegment) {
    // Merge into the LAST reasoning row of the current turn, wherever it
    // sits — thinking deltas interleave with ANSWER rows, and a fresh row
    // per chunk remounts the reasoning container (replaying its entry
    // animation = visible blink). Keeping the row in place also preserves
    // reasoning-above-answer ordering.
    //
    // A TOOL row is a hard boundary: the model finished thinking, ran a
    // tool, and a later thinking chunk is a NEW segment. Stopping the
    // backward scan at tool rows keeps interleaved-answer merges while
    // preserving that.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") break;
      const kind = (msg as { kind?: string }).kind;
      if (kind === "tool_call" || kind === "tool_result") break;
      if (msg.role === "agent" && kind === "reasoning") {
        const reasoning = msg as ReasoningMessage;
        const updated: ReasoningMessage = {
          ...reasoning,
          text: reasoning.text + chunk,
        };
        return [
          ...messages.slice(0, i),
          updated,
          ...messages.slice(i + 1),
        ];
      }
    }
  }

  // New reasoning segment: insert BEFORE the trailing assistant bubble so
  // thinking stays above the answer it belongs to.
  const turnStart = latestUserIndex(messages) + 1;
  const last = messages[messages.length - 1];
  const insertAt =
    messages.length > turnStart && last && isAssistantBubble(last)
      ? messages.length - 1
      : messages.length;

  const row: ReasoningMessage = {
    id: `reasoning-${now}-${messages.length}`,
    kind: "reasoning",
    role: "agent",
    text: chunk,
  };
  return [...messages.slice(0, insertAt), row, ...messages.slice(insertAt)];
}
