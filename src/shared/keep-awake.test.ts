import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  createKeepAwake,
  keepAwakeWanted,
  parseKeepAwakeMode,
  type PowerSaveBlockerLike,
} from "./keep-awake";

function fakeBlocker(): PowerSaveBlockerLike & { started: Set<number>; stops: number[] } {
  let next = 0;
  const started = new Set<number>();
  const stops: number[] = [];
  return {
    started,
    stops,
    isStarted: (id) => started.has(id),
    start: () => {
      const id = ++next;
      started.add(id);
      return id;
    },
    stop: (id) => {
      stops.push(id);
      started.delete(id);
    },
  };
}

describe("keep awake", () => {
  it("parses modes and keeps the legacy boolean meaning", () => {
    expect(parseKeepAwakeMode("while-working")).toBe("while-working");
    expect(parseKeepAwakeMode("always")).toBe("always");
    expect(parseKeepAwakeMode(true)).toBe("always");
    expect(parseKeepAwakeMode(false)).toBe("off");
    expect(parseKeepAwakeMode("bogus")).toBeNull();
    expect(DEFAULT_KEEP_AWAKE_MODE).toBe("while-working");
  });

  it("holds the blocker only when the mode and the live turn picture agree", () => {
    expect(keepAwakeWanted("off", true)).toBe(false);
    expect(keepAwakeWanted("always", false)).toBe(true);
    expect(keepAwakeWanted("while-working", false)).toBe(false);
    expect(keepAwakeWanted("while-working", true)).toBe(true);
  });

  it("holds at most one blocker no matter how often it is turned on", () => {
    const blocker = fakeBlocker();
    const keepAwake = createKeepAwake(blocker);
    expect(keepAwake.set(true)).toBe(true);
    expect(keepAwake.set(true)).toBe(true);
    expect(blocker.started.size).toBe(1);
    expect(keepAwake.set(false)).toBe(false);
    expect(keepAwake.set(false)).toBe(false);
    expect(blocker.stops).toEqual([1]);
  });

  it("re-acquires after a released blocker instead of reusing the stale id", () => {
    const blocker = fakeBlocker();
    const keepAwake = createKeepAwake(blocker);
    keepAwake.set(true);
    keepAwake.set(false);
    keepAwake.set(true);
    expect(keepAwake.isActive()).toBe(true);
    expect([...blocker.started]).toEqual([2]);
  });
});
