import { describe, it, expect } from "vitest";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampZoomLevel,
  nextZoomLevel,
} from "../src/main/zoom";

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
