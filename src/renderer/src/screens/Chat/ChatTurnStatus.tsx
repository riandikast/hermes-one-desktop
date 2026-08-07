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
}: {
  isLoading: boolean;
  messages: ChatMessage[];
}): React.JSX.Element | null {
  const startRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLoading) {
      startRef.current = null;
      return;
    }
    if (startRef.current === null) startRef.current = Date.now();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isLoading]);

  if (!isLoading) return null;

  const tool = runningTool(messages);
  const last = messages[messages.length - 1];
  const lastKind = last ? (last as { kind?: string }).kind : undefined;
  const label = tool
    ? `Running ${tool.name}`
    : lastKind === "reasoning"
      ? "Thinking…"
      : "Working…";
  const elapsed =
    startRef.current !== null ? Math.max(0, now - startRef.current) : 0;

  return (
    <div className="chat-turn-status" role="status" aria-live="polite">
      <Loader2 size={13} className="chat-turn-status-spinner" />
      <span className="chat-turn-status-label">{label}</span>
      {elapsed >= 1000 && (
        <span className="chat-turn-status-elapsed">
          {formatElapsed(elapsed)}
        </span>
      )}
    </div>
  );
});
