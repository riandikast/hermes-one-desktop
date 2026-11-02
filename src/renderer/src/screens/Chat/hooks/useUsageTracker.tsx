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
  /** Stable source-turn identity; used only when the producer supplies one. */
  sourceId?: string;
}

const STORAGE_KEY = "hermes.usage.history.v1";
const MAX_RECORDS = 2000;
const HISTORY_CHANGED_EVENT = "hermes-usage-history-changed";

/**
 * Remove only records proven to be duplicates by stable source-turn identity.
 * Equal token counts are valid for distinct turns, even seconds apart.
 */
export function dedupeAndTrim(records: UsageRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  const sourceIds = new Set<string>();
  for (const raw of records) {
    if (!raw || !validTokenCounts(raw) ||
        ![raw.id, raw.timestamp, raw.provider, raw.model].every((value) => typeof value === "string") ||
        !Number.isFinite(Date.parse(raw.timestamp))) continue;
    // Reconcile the stored total: old records kept the payload's `total`,
    // which can exceed input+output (cached/context tokens) — that made the
    // per-model breakdown and activity strip sum to MORE than the grand
    // total card. Always derive it from the two token counts.
    const r: UsageRecord = { ...raw, totalTokens: raw.inputTokens + raw.outputTokens };
    if (r.sourceId) {
      if (sourceIds.has(r.sourceId)) continue;
      sourceIds.add(r.sourceId);
    }
    out.push(r);
  }
  return out.slice(0, MAX_RECORDS);
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

function validTokenCounts(value: TokenCounts): boolean {
  return [value.inputTokens, value.outputTokens].every(
    (count) => Number.isSafeInteger(count) && count >= 0,
  );
}

/** Convert a cumulative session snapshot to one turn's token delta. */
export function tokenUsageDelta(
  current: TokenCounts,
  baseline: TokenCounts | null,
): TokenCounts | null {
  if (!validTokenCounts(current) || (baseline && !validTokenCounts(baseline))) return null;
  if (!baseline) return null;
  const inputTokens = current.inputTokens - baseline.inputTokens;
  const outputTokens = current.outputTokens - baseline.outputTokens;
  if (inputTokens < 0 || outputTokens < 0) return null;
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

function load(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const next = dedupeAndTrim(parsed as UsageRecord[]);
    // Persist the cleanup immediately so the corrupted history doesn't keep
    // re-loading (and re-inflating the totals) on every app start.
    if (next.length !== (parsed as UsageRecord[]).length) {
      save(next);
    }
    return next;
  } catch {
    return [];
  }
}

function save(records: UsageRecord[]): void {
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
export function useUsageTracker(): {
  records: UsageRecord[];
  recordUsage: (entry: Omit<UsageRecord, "id" | "timestamp">) => void;
  clearUsage: () => void;
  refreshUsage: () => void;
  totals: UsageTotals;
} {
  const [records, setRecords] = useState<UsageRecord[]>(() => load());

  // Re-read when the page regains focus or storage changes from another tab.
  useEffect(() => {
    const onFocus = (): void => setRecords(load());
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY || e.key === null) setRecords(load());
    };
    const onHistoryChanged = (): void => setRecords(load());
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener(HISTORY_CHANGED_EVENT, onHistoryChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HISTORY_CHANGED_EVENT, onHistoryChanged);
    };
  }, []);

  const recordUsage = useCallback((entry: Omit<UsageRecord, "id" | "timestamp">) => {
    if (!validTokenCounts(entry)) return;
    // Every mounted chat writes this store. React state can lag another chat
    // or Clear history; read the latest ledger before each synchronous write.
    const current = load();
    if (entry.sourceId && current.some((record) => record.sourceId === entry.sourceId)) return;
    const next = dedupeAndTrim([
      { ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      ...current,
    ]);
    save(next);
    setRecords(next);
    window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
  }, []);

  const clearUsage = useCallback(() => {
    setRecords([]);
    save([]);
    window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
  }, []);

  const refreshUsage = useCallback(() => setRecords(load()), []);

  return {
    records,
    recordUsage,
    clearUsage,
    refreshUsage,
    totals: aggregateTotals(records),
  };
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
