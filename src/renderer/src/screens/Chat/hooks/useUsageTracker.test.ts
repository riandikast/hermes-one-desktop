import { describe, expect, it } from "vitest";
import { dedupeAndTrim, type UsageRecord } from "./useUsageTracker";

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
  it("collapses a run of identical duplicates (legacy loop spam)", () => {
    const records = [
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:00.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:01.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:02.000Z"),
      rec({ input: 1200, output: 80 }, "2026-08-04T10:00:03.000Z"),
    ];
    expect(dedupeAndTrim(records)).toHaveLength(1);
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
    expect(out.length).toBeLessThanOrEqual(2000);
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
