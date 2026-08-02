import { describe, it, expect } from "vitest";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampZoomLevel,
  nextZoomLevel,
  zoomBy,
  zoomReset,
  zoomApply,
  type ZoomTarget,
} from "../src/main/zoom";

function fakeTarget(
  initial = 0,
): { target: ZoomTarget; levels: number[]; sent: number[] } {
  let level = initial;
  const levels: number[] = [];
  const sent: number[] = [];
  const target: ZoomTarget = {
    webContents: {
      getZoomLevel: () => level,
      setZoomLevel: (l: number) => {
        level = l;
        levels.push(l);
      },
      send: (_channel: string, l: number) => {
        sent.push(l);
      },
    },
  };
  return { target, levels, sent };
}

describe("clampZoomLevel", () => {
  it("passes through values inside range", () => {
    expect(clampZoomLevel(0)).toBe(0);
    expect(clampZoomLevel(2)).toBe(2);
  });
  it("clamps below min", () => {
    expect(clampZoomLevel(ZOOM_MIN - 1)).toBe(ZOOM_MIN);
  });
  it("clamps above max", () => {
    expect(clampZoomLevel(ZOOM_MAX + 1)).toBe(ZOOM_MAX);
  });
});

describe("nextZoomLevel", () => {
  it("steps by ZOOM_STEP per delta", () => {
    expect(nextZoomLevel(0, 1)).toBe(ZOOM_STEP);
    expect(nextZoomLevel(0, -1)).toBe(-ZOOM_STEP);
    expect(nextZoomLevel(0, 2)).toBe(ZOOM_STEP * 2);
  });
  it("never exceeds the range", () => {
    expect(nextZoomLevel(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(nextZoomLevel(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
  it("delta 0 is identity", () => {
    expect(nextZoomLevel(1.5, 0)).toBe(1.5);
  });
});

describe("zoomBy / zoomReset / zoomApply", () => {
  it("zooms, applies, and broadcasts the new level", () => {
    const { target, levels, sent } = fakeTarget();
    const out = zoomBy(target, 1);
    expect(out).toBe(ZOOM_STEP);
    expect(levels).toEqual([ZOOM_STEP]);
    expect(sent).toEqual([ZOOM_STEP]);
  });
  it("zoomReset returns to level 0 and broadcasts", () => {
    const { target, levels, sent } = fakeTarget(2);
    const out = zoomReset(target);
    expect(out).toBe(0);
    expect(levels).toEqual([0]);
    expect(sent).toEqual([0]);
  });
  it("zoomApply clamps and broadcasts", () => {
    const { target, levels, sent } = fakeTarget();
    const out = zoomApply(target, 99);
    expect(out).toBe(ZOOM_MAX);
    expect(levels).toEqual([ZOOM_MAX]);
    expect(sent).toEqual([ZOOM_MAX]);
  });
  it("zoomApply uses the stored level when in range", () => {
    const { target, levels } = fakeTarget();
    const out = zoomApply(target, -1);
    expect(out).toBe(-1);
    expect(levels).toEqual([-1]);
  });
});
