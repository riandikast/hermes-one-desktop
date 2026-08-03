import { useCallback, useEffect, useState } from "react";

/**
 * One row in the per-message usage log. Persisted to localStorage so the
 * Usage page survives across restarts and can show a full history.
 */
export interface UsageRecord {
  id: string;
  /** Wall-clock ISO string at the moment the gateway reported usage. */
  timestamp: string;
  /** Provider name (e.g. "custom", "nous") at the time of the turn. */
  provider: string;
  /** Model identifier the turn was sent to. */
  model: string;
  /** Tokens billed on the request (input). */
  inputTokens: number;
  /** Tokens billed on the response (output). */
  outputTokens: number;
  /** input + output — what most dashboards call "total". */
  totalTokens: number;
  /** Context window occupancy at end of the turn (only set when the
   *  compressor reports it). Lets the usage page show a small context sparkline. */
  contextTokens?: number;
  contextMax?: number;
  /** Cost in USD reported by the gateway (optional). */
  cost?: number;
}

const STORAGE_KEY = "hermes.usage.history.v1";
const MAX_RECORDS = 2000;

/** De-duplicate by `input+output` token sum within a 750ms window — the
 *  gateway can emit two usage events for one turn (preview + final) and we
 *  don't want both rows in the table. */
function dedupeAndTrim(records: UsageRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  let last: UsageRecord | null = null;
  for (const r of records) {
    if (
      last &&
      Math.abs(new Date(r.timestamp).getTime() - new Date(last.timestamp).getTime()) < 750 &&
      r.inputTokens === last.inputTokens &&
      r.outputTokens === last.outputTokens
    ) {
      // Skip duplicate preview/final pair.
      continue;
    }
    out.push(r);
    last = r;
  }
  if (out.length > MAX_RECORDS) out.splice(0, out.length - MAX_RECORDS);
  return out;
}

function load(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeAndTrim(parsed as UsageRecord[]);
  } catch {
    return [];
  }
}

function save(records: UsageRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* quota exceeded / disabled — silently skip */
  }
}

/**
 * Persistent token-usage log + totals. Every chat turn pushes a record into
 * the history (via `recordUsage`); the totals hook derives live aggregates
 * for the Usage page.
 */
export function useUsageTracker() {
  const [records, setRecords] = useState<UsageRecord[]>(() => load());

  // Re-read when the page regains focus or storage changes from another tab.
  useEffect(() => {
    const onFocus = () => setRecords(load());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRecords(load());
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const recordUsage = useCallback((entry: Omit<UsageRecord, "id" | "timestamp">) => {
    setRecords((prev) => {
      const next: UsageRecord[] = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          ...entry,
        },
        ...prev,
      ];
      save(next);
      return next;
    });
  }, []);

  const clearUsage = useCallback(() => {
    setRecords([]);
    save([]);
  }, []);

  return { records, recordUsage, clearUsage, totals: aggregateTotals(records) };
}

export interface UsageTotals {
  /** Total input tokens across all recorded turns. */
  inputTokens: number;
  /** Total output tokens across all recorded turns. */
  outputTokens: number;
  /** input + output across all recorded turns. */
  totalTokens: number;
  /** Total cost across all recorded turns (USD). */
  totalCost: number;
  /** Number of recorded turns. */
  turnCount: number;
  /** Oldest recorded timestamp (ISO) or null if no records. */
  oldestAt: string | null;
  /** Newest recorded timestamp (ISO) or null if no records. */
  newestAt: string | null;
}

export function aggregateTotals(records: UsageRecord[]): UsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  for (const r of records) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    totalCost += r.cost ?? 0;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCost,
    turnCount: records.length,
    oldestAt: records.length > 0 ? records[records.length - 1].timestamp : null,
    newestAt: records.length > 0 ? records[0].timestamp : null,
  };
}
