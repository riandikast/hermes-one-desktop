import { beforeEach, describe, expect, it } from "vitest";
import {
  migratePlanMode,
  planModeKey,
  readPlanMode,
  writePlanMode,
} from "./planMode";

describe("per-session plan mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is off by default", () => {
    expect(readPlanMode("s1")).toBe(false);
  });

  it("keeps each session's mode independent", () => {
    writePlanMode("s1", true);
    writePlanMode("s2", false);

    expect(readPlanMode("s1")).toBe(true);
    expect(readPlanMode("s2")).toBe(false);
  });

  it("does not leak PLAN into a session that never set it", () => {
    writePlanMode("s1", true);
    // A brand-new session (and a session id never toggled) must stay BUILD.
    expect(readPlanMode("brand-new")).toBe(false);
    expect(readPlanMode(null)).toBe(false);
    expect(readPlanMode(undefined)).toBe(false);
  });

  it("toggling one session off leaves the other session's PLAN on", () => {
    writePlanMode("s1", true);
    writePlanMode("s2", true);

    writePlanMode("s1", false);

    expect(readPlanMode("s1")).toBe(false);
    expect(readPlanMode("s2")).toBe(true);
  });

  it("uses a distinct key per session", () => {
    expect(planModeKey("abc")).not.toBe(planModeKey("abd"));
  });

  it("carries a draft's mode over when the session id is assigned", () => {
    // New chat has no session id yet — the toggle writes under the run id.
    writePlanMode("run-1", true);

    migratePlanMode("run-1", "session-9");

    expect(readPlanMode("session-9")).toBe(true);
    // The draft key is cleared so a later scratch chat reusing the run id
    // does not silently start in PLAN.
    expect(readPlanMode("run-1")).toBe(false);
  });

  it("migration is a no-op when there is nothing to move", () => {
    migratePlanMode("run-1", "session-9");
    expect(readPlanMode("session-9")).toBe(false);
  });
});
