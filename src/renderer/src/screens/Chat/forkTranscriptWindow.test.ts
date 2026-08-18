import { describe, expect, it } from "vitest";
import {
  FIRST_PAINT_BUDGET,
  MIN_VISIBLE_GROUPS,
  RENDER_BUDGET,
  buildTranscriptGroups,
  firstVisibleGroupIndex,
  liveTailStart,
} from "./forkTranscriptWindow";

const w = (n: number) => ({ id: String(n), role: n % 5 === 0 ? "user" : "agent" });

describe("forkTranscriptWindow", () => {
  it("keeps transcript within budget via weighted groups", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => w(i));
    const weights = msgs.map(() => 80);
    const groups = buildTranscriptGroups(msgs, weights);
    const idx = firstVisibleGroupIndex(groups, RENDER_BUDGET, MIN_VISIBLE_GROUPS);
    expect(groups.length - idx).toBeGreaterThan(0);
    expect(groups.length - idx).toBeLessThanOrEqual(groups.length);
  });

  it("first-paint budget is intentionally small so session switch is instant", () => {
    expect(FIRST_PAINT_BUDGET).toBeLessThanOrEqual(30);
    expect(RENDER_BUDGET).toBeGreaterThan(FIRST_PAINT_BUDGET);
  });

  it("live tail stays within [MIN,MAX] turns regardless of weights", () => {
    const msgs = Array.from({ length: 12 }, (_, i) => w(i));
    const weights = msgs.map(() => (i) => (i % 3 === 0 ? 80 : 5));
    const flat = weights.map((f, i) => (f as unknown as (n: number) => number)(i));
    const groups = buildTranscriptGroups(msgs, flat);
    const start = liveTailStart(groups);
    expect(groups.length - start).toBeGreaterThanOrEqual(2);
    expect(groups.length - start).toBeLessThanOrEqual(6);
  });
});
