import { memo, useId, useState } from "react";
import "./ContextGauge.css";
import { useI18n } from "../../components/useI18n";

export interface ContextUsage {
  /** Current context occupancy = latest turn's prompt tokens. */
  used: number;
  /** Model context window in tokens. */
  window: number;
  estimated?: boolean;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  onCompact?: () => void;
  /** "New session with context" — mint a fresh session seeded with a
   *  handoff of this conversation's working state. */
  onNewSessionWithContext?: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const val = (n / 1_000_000).toFixed(1);
    return `${val.endsWith(".0") ? val.slice(0, -2) : val}M`;
  }
  if (n >= 1000) {
    const val = (n / 1000).toFixed(1);
    return `${val.endsWith(".0") ? val.slice(0, -2) : val}k`;
  }
  return String(Math.round(n));
}

/**
 * Small circular gauge showing how full the model's context window is, with a
 * hover/focus tooltip breaking down tokens used and prompt-cache hits. Mirrors
 * the webui's context indicator. Auto-compress threshold is intentionally
 * omitted — the gateway doesn't expose it over the chat API.
 *
 * Always renders (even with no usage yet) so the user can see and click the
 * gauge immediately on app start. When `usage` is null/empty the ring is
 * empty (unknown) and the popover explains missing data — this prevents the
 * gauge from mysteriously appearing/disappearing as usage arrives.
 */
export const ContextGauge = memo(function ContextGauge({
  used,
  window: ctxWindow,
  estimated = true,
  cacheReadTokens,
  cacheWriteTokens,
  onCompact,
  onNewSessionWithContext,
}: ContextUsage): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasData =
    Number.isFinite(used) &&
    used >= 0 &&
    Number.isFinite(ctxWindow) &&
    ctxWindow > 0;
  const pct = hasData ? Math.round((used / ctxWindow) * 100) : 0;
  const left = Math.max(0, 100 - pct);

  // Ring geometry.
  const size = 26;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, pct) / 100) * circumference;

  const hasCache =
    cacheReadTokens !== undefined || cacheWriteTokens !== undefined;
  const cacheHitPct =
    used > 0 && cacheReadTokens
      ? Math.min(100, Math.round((cacheReadTokens / used) * 100))
      : 0;

  return (
    <div
      className={`chat-ctx-gauge ${open ? "open" : ""} ${hasData ? "" : "chat-ctx-gauge--empty"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="chat-ctx-trigger"
        aria-label={`Context usage: ${hasData ? `${estimated ? "estimated " : ""}${pct}%` : "unknown"}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            className="chat-ctx-gauge-track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
          />
          <circle
            className="chat-ctx-gauge-fill"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="chat-ctx-gauge-num">{hasData ? pct : "—"}</span>
      </button>

      <div
        id={panelId}
        className="chat-ctx-tooltip"
        role="group"
        aria-label="Context usage details"
      >
        <div className="chat-ctx-tooltip-title">
          {t("chat.contextWindow")}
          {estimated && hasData ? " (estimated)" : ""}
        </div>
        {hasData ? (
          <>
            <div>{t("chat.contextUsed", { pct, left })}</div>
            <div>
              {t("chat.contextTokens", {
                used: fmtTokens(used),
                total: fmtTokens(ctxWindow),
              })}
            </div>
            {hasCache && (
              <div>
                {t("chat.contextCache", {
                  pct: cacheHitPct,
                  read: fmtTokens(cacheReadTokens || 0),
                  write: fmtTokens(cacheWriteTokens || 0),
                })}
              </div>
            )}
          </>
        ) : (
          <div className="chat-ctx-tooltip-empty">
            Context usage unknown — waiting for occupancy and model context
            limit.
          </div>
        )}
        {onCompact && (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              onCompact();
            }}
            style={{
              marginTop: 6,
              width: "100%",
              fontSize: 11,
              padding: "3px 6px",
              cursor: "pointer",
            }}
          >
            Compress Context (/compact)
          </button>
        )}
        {onNewSessionWithContext && (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              onNewSessionWithContext();
            }}
            style={{
              marginTop: onCompact ? 4 : 6,
              width: "100%",
              fontSize: 11,
              padding: "3px 6px",
              cursor: "pointer",
            }}
            title="Start a fresh session seeded with a handoff of this conversation's working state"
          >
            New session with context
          </button>
        )}
      </div>
    </div>
  );
});
