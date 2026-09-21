import { describe, expect, it } from "vitest";
import { buildFontStack, stackFor } from "./FontProvider";
import { DEFAULT_FONT, FONT_OPTIONS, SYSTEM_FONT_PREFIX } from "../constants";

describe("stackFor", () => {
  it("resolves a built-in preset to its declared stack", () => {
    for (const option of FONT_OPTIONS) {
      expect(stackFor(option.value)).toBe(option.stack);
    }
  });

  it("resolves a chosen system family to a quoted family + fallback chain", () => {
    expect(stackFor(SYSTEM_FONT_PREFIX + "Cascadia Code")).toBe(
      buildFontStack("Cascadia Code"),
    );
  });

  it("falls back to the default preset for unknown or empty values", () => {
    const fallback = FONT_OPTIONS.find((o) => o.value === DEFAULT_FONT)!.stack;
    expect(stackFor("no-such-preset")).toBe(fallback);
    // A system entry with an empty family is treated as unknown, not as a
    // stack that would render with no family at all.
    expect(stackFor(SYSTEM_FONT_PREFIX)).toBe(fallback);
    expect(stackFor(SYSTEM_FONT_PREFIX + "   ")).toBe(fallback);
  });

  it("escapes quotes so a family name cannot break out of the CSS string", () => {
    const stack = buildFontStack('Weird"Family');
    expect(stack.startsWith('"Weird\\"Family"')).toBe(true);
  });

  it("keeps a generic fallback after the family so text always renders", () => {
    const stack = stackFor(SYSTEM_FONT_PREFIX + "Some Font");
    expect(stack).toMatch(/sans-serif$/);
  });
});
