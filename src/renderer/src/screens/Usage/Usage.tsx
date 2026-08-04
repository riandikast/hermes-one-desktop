import { useMemo, useState } from "react";
import {
  Trash2,
  RefreshCw,
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Layers,
  Brain,
  Calendar,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { useUsageTracker } from "../Chat/hooks/useUsageTracker";
import type { UsageRecord } from "../Chat/hooks/useUsageTracker";

/**
 * Token-usage tracker dashboard. Hero summary cards with icon badges and
 * gradient accents, a sparkline strip showing the last 7 days of activity, a
 * per-model breakdown donut/bar, and a per-turn table. Records are de-duped
 * (preview + final pairs from the gateway collapse into one row) and capped
 * at 2000 entries to keep the dashboard responsive.
 */
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  tone: "input" | "output" | "total" | "cost" | "turns";
  sub?: string;
}): React.JSX.Element {
  return (
    <div className={`usage-stat usage-stat--${tone}`}>
      <div className="usage-stat-icon">
        <Icon size={15} />
      </div>
      <div className="usage-stat-body">
        <div className="usage-stat-label">{label}</div>
        <div className="usage-stat-value">{value}</div>
        {sub && <div className="usage-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

/** Simple horizontal bars showing per-model token share. */
function ModelBreakdown({
  records,
}: {
  records: UsageRecord[];
}): React.JSX.Element | null {
  const byModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      map.set(r.model, (map.get(r.model) ?? 0) + r.totalTokens);
    }
    return Array.from(map.entries())
      .map(([model, total]) => ({ model, total }))
      .sort((a, b) => b.total - a.total);
  }, [records]);

  const grandTotal = useMemo(
    () => byModel.reduce((sum, m) => sum + m.total, 0),
    [byModel],
  );

  if (grandTotal === 0) return null;

  return (
    <div className="usage-panel">
      <div className="usage-panel-header">
        <Layers size={13} />
        <span>Tokens by model</span>
      </div>
      <div className="usage-panel-body usage-panel-body--stack">
        {byModel.slice(0, 5).map((m) => (
          <div key={m.model} className="usage-breakdown-row">
            <span className="usage-breakdown-label" title={m.model}>
              {m.model.split("/").pop() || m.model}
            </span>
            <div className="usage-breakdown-track">
              <div
                className="usage-breakdown-fill"
                style={{ width: `${Math.max(2, (m.total / grandTotal) * 100)}%` }}
              />
            </div>
            <span className="usage-breakdown-value">{fmtTokens(m.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact token count for chart labels. */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Sparkline-ish strip: daily total tokens for the last 14 days. */
function ActivityStrip({
  records,
}: {
  records: UsageRecord[];
}): React.JSX.Element | null {
  const daily = useMemo(() => {
    const days = new Map<string, number>();
    for (const r of records) {
      const key = r.timestamp.slice(0, 10);
      days.set(key, (days.get(key) ?? 0) + r.totalTokens);
    }
    return Array.from(days.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14);
  }, [records]);

  if (daily.length === 0) return null;
  const max = Math.max(...daily.map((d) => d[1]), 1);
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="usage-panel">
      <div className="usage-panel-header">
        <Calendar size={13} />
        <span>Activity (last {daily.length} days)</span>
      </div>
      <div className="usage-activity-chart">
        {daily.map(([day, total]) => (
          <div
            key={day}
            className={`usage-activity-col ${day === todayKey ? "today" : ""}`}
            title={`${day}: ${fmtTokens(total)}`}
          >
            <div className="usage-activity-value">{fmtCompact(total)}</div>
            <div className="usage-activity-bar-wrap">
              <div
                className="usage-activity-bar"
                style={{ height: `${Math.max(4, (total / max) * 100)}%` }}
              />
            </div>
            <div className="usage-activity-day">
              {day === todayKey ? "Today" : fmtDay(day)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cap the rendered table rows — 2000 DOM rows on first mount made tab
 *  switches janky. Show the latest N with a footer note. */
const TABLE_ROW_CAP = 100;

export default function Usage(): React.JSX.Element {
  const { t } = useI18n();
  const { records, clearUsage, totals } = useUsageTracker();
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterModel, setFilterModel] = useState<string>("");

  const modelsInUse = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) set.add(r.model);
    return Array.from(set).sort();
  }, [records]);

  const visibleRecords = useMemo(() => {
    const filtered = filterModel
      ? records.filter((r) => r.model === filterModel)
      : records;
    return filtered.slice(0, TABLE_ROW_CAP);
  }, [records, filterModel]);

  return (
    <div className="usage-page">
      {/* Hero header */}
      <div className="usage-hero">
        <div className="usage-hero-text">
          <div className="usage-hero-eyebrow">
            <Activity size={14} />
            <span>Token usage</span>
          </div>
          <h2 className="usage-hero-title">{t("navigation.usage")} Dashboard</h2>
          <p className="usage-hero-sub">
            Track every model response: input/output tokens and context
            occupancy, in real time.
          </p>
        </div>
        <div className="usage-page-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.dispatchEvent(new Event("focus"))}
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              confirmClear ? "btn-danger" : "btn-secondary"
            }`}
            onClick={() => {
              if (confirmClear) {
                clearUsage();
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
                window.setTimeout(() => setConfirmClear(false), 3000);
              }
            }}
          >
            <Trash2 size={13} />
            <span>{confirmClear ? "Confirm clear?" : "Clear history"}</span>
          </button>
        </div>
      </div>

      {/* Hero stat cards */}
      <div className="usage-stat-grid">
        <StatCard
          icon={ArrowDownRight}
          label="Input tokens"
          value={fmtTokens(totals.inputTokens)}
          tone="input"
        />
        <StatCard
          icon={ArrowUpRight}
          label="Output tokens"
          value={fmtTokens(totals.outputTokens)}
          tone="output"
        />
        <StatCard
          icon={Layers}
          label="Grand total"
          value={fmtTokens(totals.totalTokens)}
          tone="total"
          sub="input + output"
        />
        <StatCard
          icon={Brain}
          label="Turns"
          value={String(totals.turnCount)}
          tone="turns"
        />
      </div>

      {/* Activity + model breakdown */}
      <div className="usage-dual-panels">
        <ActivityStrip records={records} />
        <ModelBreakdown records={records} />
      </div>

      {/* Filters */}
      {modelsInUse.length > 0 && (
        <div className="usage-filter-row">
          <label htmlFor="usage-filter-model">Model:</label>
          <select
            id="usage-filter-model"
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className="usage-filter-select"
          >
            <option value="">All ({modelsInUse.length})</option>
            {modelsInUse.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {filterModel && (
            <span className="usage-filter-count">
              {visibleRecords.length} of {records.length} turns
            </span>
          )}
        </div>
      )}

      {/* Table */}
      {visibleRecords.length === 0 ? (
        <div className="usage-empty">
          <p>No token usage recorded yet.</p>
          <p className="usage-empty-hint">
            Send a chat message — every model response appends a record here.
          </p>
        </div>
      ) : (
        <div className="usage-table-wrapper">
          <table className="usage-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Provider</th>
                <th className="usage-table-num">Input</th>
                <th className="usage-table-num">Output</th>
                <th className="usage-table-num">Total</th>
                <th className="usage-table-num">Context</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((r) => (
                <tr key={r.id}>
                  <td className="usage-table-mono">{fmtDate(r.timestamp)}</td>
                  <td>{r.model}</td>
                  <td>{r.provider}</td>
                  <td className="usage-table-num">
                    {fmtTokens(r.inputTokens)}
                  </td>
                  <td className="usage-table-num">
                    {fmtTokens(r.outputTokens)}
                  </td>
                  <td className="usage-table-num">
                    <strong>{fmtTokens(r.totalTokens)}</strong>
                  </td>
                  <td className="usage-table-num">
                    {r.contextMax
                      ? `${Math.round(
                          ((r.contextTokens ?? 0) / r.contextMax) * 100,
                        )}%`
                      : r.contextTokens
                        ? fmtTokens(r.contextTokens)
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totals.oldestAt && totals.newestAt && (
        <div className="usage-footer-meta">
          <span>
            Oldest: <code>{fmtDate(totals.oldestAt)}</code>
          </span>
          <span>·</span>
          <span>
            Newest: <code>{fmtDate(totals.newestAt)}</code>
          </span>
          {records.length > TABLE_ROW_CAP && (
            <>
              <span>·</span>
              <span>
                Showing latest {TABLE_ROW_CAP} of {records.length} turns
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export type { UsageRecord };
