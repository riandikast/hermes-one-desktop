import { useEffect, useState } from "react";
import "./LocalSessionCounter.css";
import { Refresh } from "../../assets/icons";

export function LocalSessionCounter({ sessionId, isLoading, refreshing = false, onRefresh }: {
  sessionId: string | null;
  isLoading: boolean;
  refreshing?: boolean;
  onRefresh?: () => Promise<void>;
}): React.JSX.Element {
  const [result, setResult] = useState<{ id: string; count: number | null } | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function refresh(): Promise<void> {
      let count: number | null = null;
      try {
        const connection = await window.hermesAPI.getConnectionConfig();
        if (connection.mode === "local") {
          // ponytail: existing metadata API only; no transcript hydration or new IPC.
          for (let offset = 0; !cancelled; offset += 200) {
            const rows = await window.hermesAPI.listSessions(200, offset);
            const row = rows.find((item) => item.id === sessionId);
            if (row) {
              count = Number.isSafeInteger(row.messageCount) && row.messageCount >= 0 ? row.messageCount : null;
              break;
            }
            if (rows.length < 200) break;
          }
        }
      } catch { /* A failed read is unknown, never zero. */ }
      if (!cancelled) setResult({ id: sessionId!, count });
    }
    void refresh();
    return () => { cancelled = true; };
  }, [sessionId, isLoading, refreshing]);
  const count = result?.id === sessionId ? result.count : null;
  return (
    <span className="chat-local-session-counter" tabIndex={0}
      aria-label={`Local session database: ${count == null ? "unavailable" : `${count.toLocaleString("en-US")} messages`}`}
      title="Persisted message count for this local session segment, not model tokens. Hermes defaults to a 20,000-message resume safety guard (configurable). Full resume can count ancestor and compacted rows too; this metadata is not that guard's numerator, so no safety percentage is inferred.">
      DB · {count == null ? "unavailable" : `${count.toLocaleString("en-US")} messages`}
      {onRefresh && <button type="button" className="chat-session-refresh"
        aria-label="Refresh session" aria-busy={refreshing}
        title={isLoading ? "Wait for the active turn before refreshing" : "Reload session history from database"}
        disabled={!sessionId || isLoading || refreshing} onClick={() => void onRefresh()}>
        <Refresh size={13} />
      </button>}
    </span>
  );
}
