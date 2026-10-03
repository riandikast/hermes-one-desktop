import { memo, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ChatMessage } from "./types";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The last in-flight tool call in the current turn (a tool_call with no
 *  matching tool_result after it), or null when the agent is not awaiting a
 *  tool. Scans backward from the end of the turn. */
function runningTool(messages: ChatMessage[]): { name: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    const kind = (m as { kind?: string }).kind;
    if (kind === "tool_call") {
      const call = m as unknown as { callId?: string; name?: string };
      let matched = false;
      for (let j = i + 1; j < messages.length; j++) {
        const n = messages[j];
        if (
          (n as { kind?: string }).kind === "tool_result" &&
          (n as unknown as { callId?: string }).callId === call.callId
        ) {
          matched = true;
          break;
        }
      }
      if (!matched) return { name: call.name || "tool" };
      // Resolved — keep scanning for an earlier unresolved call.
      continue;
    }
    if (kind === "reasoning" || kind === "tool_result" || kind === "clarify") {
      continue;
    }
    break; // a bubble — no unresolved tool ahead of it
  }
  return null;
}

/**
 * The live elapsed counter, isolated so its 1 Hz tick re-renders ONLY this
 * span.
 *
 * It used to live in `ChatTurnStatus` itself, which receives `messages`. Since
 * `messages` is a fresh array on every parent render, `memo()` on
 * `ChatTurnStatus` could never bail out, so each tick re-rendered the status
 * strip AND (because the state update belonged to that component) propagated a
 * commit through the chat tree — measured at ~1 commit/second while idle.
 * Keeping `now` in a leaf whose props are two primitives confines the re-render
 * to this node.
 */
const ElapsedLabel = memo(function ElapsedLabel({
  startedAt,
}: {
  startedAt: number;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  return (
    <span className="chat-turn-status-elapsed">{formatElapsed(elapsed)}</span>
  );
});

/**
 * Always-visible agent-turn status strip (Codex / Claude Code style): while
 * the turn is loading it shows a spinner plus what the agent is doing —
 * "Thinking…", "Working…", or "Running <tool> · 1m 23s" with a live elapsed
 * timer. Long-running tools (a multi-minute `flutter build`) previously left
 * the chat looking finished with no visible running state, which read as "the
 * last response never appeared" (reopening can't help either — the answer
 * genuinely doesn't exist until the tool finishes and the model responds).
 */
export const ChatTurnStatus = memo(function ChatTurnStatus({
  isLoading,
  messages,
  activeSubagentCount = 0,
}: {
  isLoading: boolean;
  messages: ChatMessage[];
  activeSubagentCount?: number;
}): React.JSX.Element | null {
  // Anchor for the elapsed label. Held in a ref so the 1s tick cannot cause
  // this component to re-render; only `ElapsedLabel` re-renders. Assigned
  // during render (not in an effect) so the label is present on the very first
  // loading render instead of one commit later.
  const startRef = useRef<number | null>(null);
  if (isLoading) {
    if (startRef.current === null) startRef.current = Date.now();
  } else {
    startRef.current = null;
  }

  if (!isLoading && !activeSubagentCount) return null;

  const tool = runningTool(messages);
  const last = messages[messages.length - 1];
  const lastKind = last ? (last as { kind?: string }).kind : undefined;
  const childrenLabel = `${activeSubagentCount} subagent${activeSubagentCount === 1 ? "" : "s"}`;
  const label = !isLoading
    ? `Waiting for ${childrenLabel}`
    : tool
      ? `Running ${tool.name}`
      : lastKind === "reasoning"
        ? "Thinking…"
        : "Working…";

  return (
    <div className="chat-turn-status" role="status" aria-live="polite">
      <Loader2 size={13} className="chat-turn-status-spinner" />
      <span className="chat-turn-status-label">{label}</span>
      {isLoading && activeSubagentCount > 0 && (
        <span> · {childrenLabel} active</span>
      )}
      {isLoading && startRef.current !== null && (
        <ElapsedLabel startedAt={startRef.current} />
      )}
    </div>
  );
});
