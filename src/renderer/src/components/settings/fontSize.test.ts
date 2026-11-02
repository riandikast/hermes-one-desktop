// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  FONT_SIZE_STEPS,
  applyFontScale,
  applyStoredFontScale,
  readFontSizeStep,
  scaleForStep,
} from "./fontSize";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--font-scale");
});

describe("font size preference", () => {
  it("defaults to the shipped type sizes", () => {
    expect(readFontSizeStep()).toBe("default");
    expect(scaleForStep("default")).toBe(1);
  });

  it("ignores a stored value it does not know", () => {
    localStorage.setItem("hermes.fontSize", "huge");
    expect(readFontSizeStep()).toBe("default");
  });

  it("pushes the step onto :root as a scale multiplier", () => {
    applyFontScale("xlarge");
    expect(
      document.documentElement.style.getPropertyValue("--font-scale"),
    ).toBe("1.3");
  });

  it("applies the stored step on boot", () => {
    localStorage.setItem("hermes.fontSize", "large");
    applyStoredFontScale();
    expect(
      document.documentElement.style.getPropertyValue("--font-scale"),
    ).toBe("1.15");
  });

  it("orders the steps from smaller to larger text", () => {
    const scales = FONT_SIZE_STEPS.map((step) => step.scale);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(scales[0]).toBeLessThan(1);
    expect(scales[scales.length - 1]).toBeGreaterThan(1);
  });
});
