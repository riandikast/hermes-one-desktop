import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { ActiveSubagent } from "./hooks/useActiveSubagents";

/** Elapsed seconds since the child started, ticked live while it runs. */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function SubagentRow({
  child,
  onOpen,
}: {
  child: ActiveSubagent;
  onOpen?: (sessionId: string) => void;
}): React.JSX.Element {
  const elapsed = useElapsed(child.started_at);
  const sessionId = child.child_session_id;
  // The backend only reports live children, so a row IS processing. Show what
  // it is doing rather than a bare spinner.
  const activity = child.last_tool
    ? `Running ${child.last_tool}`
    : "Working…";

  return (
    <div className="chat-subagent-row">
      <div className="chat-subagent-main">
        <div className="chat-subagent-head">
          <Loader2 size={12} className="chat-turn-status-spinner" />
          <span className="chat-subagent-activity">{activity}</span>
          {elapsed > 0 && (
            <span className="chat-subagent-elapsed">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        {child.goal && (
          <div className="chat-subagent-goal" title={child.goal}>
            {child.goal}
          </div>
        )}
      </div>
      {sessionId && onOpen ? (
        <button
          type="button"
          className="chat-subagent-view"
          onClick={() => onOpen(sessionId)}
          title="Open this subagent's session (read-only)"
        >
          View
          <ChevronRight size={13} />
        </button>
      ) : (
        // No child_session_id in the snapshot means the session cannot be
        // opened yet; say so instead of offering a dead button.
        <span className="chat-subagent-nolink" title="Session not available yet">
          …
        </span>
      )}
    </div>
  );
}

/**
 * Live subagent list shown under the turn-status strip: one row per running
 * child with its current activity, elapsed time, and a button to open that
 * child's session. Opening a child is read-only (see Chat's `readOnly` run
 * flag) — the delegated child owns its turn, so a second writer must not be
 * able to submit into it.
 */
export function ChatSubagentPanel({
  subagents,
  onOpenSubagent,
  defaultOpen = false,
}: {
  subagents: ActiveSubagent[];
  onOpenSubagent?: (sessionId: string) => void;
  defaultOpen?: boolean;
}): React.JSX.Element | null {
  // Auto-expand while children run so the View button is immediately reachable
  // (the whole point is avoiding a trip to the sidebar), but remember an
  // explicit collapse so it does not spring back open on the next poll.
  const [open, setOpen] = useState(defaultOpen);
  const userToggledRef = useRef(false);
  const prevCountRef = useRef(subagents.length);

  useEffect(() => {
    const grew = subagents.length > prevCountRef.current;
    prevCountRef.current = subagents.length;
    if (grew && !userToggledRef.current) setOpen(true);
  }, [subagents.length]);

  if (subagents.length === 0) return null;

  const count = subagents.length;
  const label = `${count} subagent${count === 1 ? "" : "s"} running`;

  return (
    <div className="chat-subagent-panel">
      <button
        type="button"
        className="chat-subagent-toggle"
        aria-expanded={open}
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
      >
        <Loader2 size={12} className="chat-turn-status-spinner" />
        <span>{label}</span>
        <ChevronRight
          size={13}
          className={`chat-subagent-chevron ${open ? "is-open" : ""}`}
        />
      </button>
      {open && (
        <div className="chat-subagent-list">
          {subagents.map((child) => (
            <SubagentRow
              key={child.subagent_id}
              child={child}
              onOpen={onOpenSubagent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
