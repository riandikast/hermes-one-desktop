import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dedupeAndTrim,
  tokenUsageDelta,
  useUsageTracker,
  type UsageRecord,
} from "./useUsageTracker";

function rec(
  over: Partial<UsageRecord> & { input: number; output: number },
  ts: string,
): UsageRecord {
  return {
    id: `r-${ts}-${over.input}-${over.output}`,
    timestamp: ts,
    provider: "custom",
    model: "m1",
    inputTokens: over.input,
    outputTokens: over.output,
    totalTokens: over.input + over.output,
    ...over,
  };
}

describe("dedupeAndTrim", () => {
  it("keeps distinct turns with identical token counts close together", () => {
    const records = [
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:01.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:02.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:03.000Z"),
    ];
    expect(dedupeAndTrim(records)).toHaveLength(4);
  });

  it("deduplicates only records carrying the same stable source id", () => {
    const first = rec(
      { input: 1200, output: 80, sourceId: "session:turn-1" },
      "2026-08-04T10:00:00.000Z",
    );
    const duplicate = {
      ...first,
      id: "duplicate",
      timestamp: "2026-08-04T10:00:01.000Z",
    };
    expect(dedupeAndTrim([first, duplicate])).toHaveLength(1);
  });

  it("keeps preview+final pairs with different token counts", () => {
    const records = [
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z"),
      rec({ input: 1300, output: 95 }, "2026-08-04T10:00:01.000Z"),
    ];
    expect(dedupeAndTrim(records)).toHaveLength(2);
  });

  it("keeps identical-looking records far apart in time", () => {
    const records = [
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:05:00.000Z"),
    ];
    expect(dedupeAndTrim(records)).toHaveLength(2);
  });

  it("keeps same-timestamp records with different models", () => {
    const a = rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z");
    const b = rec(
      { input: 1200, output: 80, model: "m2" },
      "2026-08-04T10:00:01.000Z",
    );
    expect(dedupeAndTrim([a, b])).toHaveLength(2);
  });

  it("trims to the record cap", () => {
    const records = Array.from({ length: 2001 }, (_, i) =>
      rec(
        { input: i + 1, output: 1 },
        `2026-08-04T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
      ),
    );
    const out = dedupeAndTrim(records);
    expect(out).toHaveLength(2000);
    expect(out[0].inputTokens).toBe(1);
    expect(out.at(-1)?.inputTokens).toBe(2000);
  });

  it("reconciles legacy totalTokens to input + output", () => {
    const records = [
      {
        ...rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z"),
        totalTokens: 99_999, // stale payload total (cached/context tokens)
      },
    ];
    const out = dedupeAndTrim(records);
    expect(out[0].totalTokens).toBe(1280);
  });
});

describe("tokenUsageDelta", () => {
  it("records the first resumed-session turn against its prefetched baseline", () => {
    expect(
      tokenUsageDelta(
        { inputTokens: 1_250, outputTokens: 110 },
        { inputTokens: 1_000, outputTokens: 80 },
      ),
    ).toEqual({ inputTokens: 250, outputTokens: 30 });
  });

  it("keeps valid turns when only one counter increases", () => {
    expect(
      tokenUsageDelta(
        { inputTokens: 1_250, outputTokens: 80 },
        { inputTokens: 1_000, outputTokens: 80 },
      ),
    ).toEqual({ inputTokens: 250, outputTokens: 0 });
  });

  it("starts fresh sessions at zero but rejects an unknown cumulative baseline", () => {
    const first = { inputTokens: 250, outputTokens: 30 };
    expect(tokenUsageDelta(first, { inputTokens: 0, outputTokens: 0 })).toEqual(first);
    expect(tokenUsageDelta(first, null)).toBeNull();
  });

  it("ignores duplicates and re-baselines after counters reset", () => {
    const current = { inputTokens: 10, outputTokens: 4 };
    expect(tokenUsageDelta(current, current)).toBeNull();
    expect(
      tokenUsageDelta(current, { inputTokens: 500, outputTokens: 20 }),
    ).toBeNull();
  });

  it("rejects malformed provider token counts", () => {
    for (const inputTokens of [NaN, Infinity, -1, 1.5]) {
      expect(tokenUsageDelta({ inputTokens, outputTokens: 5 }, { inputTokens: 0, outputTokens: 0 })).toBeNull();
    }
  });
});

describe("shared usage history", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("updates mounted readers and merges independent chat writers without losing rows", () => {
    const first = renderHook(() => useUsageTracker());
    const second = renderHook(() => useUsageTracker());
    const entry = { provider: "custom", model: "m1", inputTokens: 10, outputTokens: 2, totalTokens: 12 };
    act(() => first.result.current.recordUsage({ ...entry, sourceId: "turn-1" }));
    expect(second.result.current.totals.totalTokens).toBe(12);
    act(() => second.result.current.recordUsage({ ...entry, sourceId: "turn-2" }));
    expect(first.result.current.totals.turnCount).toBe(2);
    act(() => first.result.current.recordUsage({ ...entry, sourceId: "turn-2" }));
    expect(second.result.current.totals.turnCount).toBe(2);
    act(() => second.result.current.clearUsage());
    expect(first.result.current.records).toEqual([]);
    act(() => first.result.current.recordUsage({ ...entry, sourceId: "turn-3" }));
    expect(second.result.current.records.map((record) => record.sourceId)).toEqual(["turn-3"]);
  });
});
