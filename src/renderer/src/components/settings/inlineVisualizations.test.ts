// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INLINE_VISUALIZATION_PROMPT,
  readInlineVisualizations,
  useInlineVisualizations,
} from "./inlineVisualizations";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useInlineVisualizations", () => {
  it("defaults off and reads only an explicit true", () => {
    expect(readInlineVisualizations()).toBe(false);
    localStorage.setItem("hermes.inlineVisualizations", "true");
    expect(readInlineVisualizations()).toBe(true);
    localStorage.setItem("hermes.inlineVisualizations", "false");
    expect(readInlineVisualizations()).toBe(false);
    localStorage.setItem("hermes.inlineVisualizations", "yes");
    expect(readInlineVisualizations()).toBe(false);
  });

  it("persists changes and broadcasts to every consumer", () => {
    const first = renderHook(() => useInlineVisualizations());
    const second = renderHook(() => useInlineVisualizations());
    const listener = vi.fn();
    window.addEventListener("hermes-inline-visualizations-changed", listener);
    try {
      act(() => {
        expect(first.result.current[1](true)).toBe(true);
      });
      expect(localStorage.getItem("hermes.inlineVisualizations")).toBe("true");
      expect(first.result.current[0]).toBe(true);
      expect(second.result.current[0]).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      act(() => {
        expect(second.result.current[1](false)).toBe(true);
      });
      expect(first.result.current[0]).toBe(false);
      expect(second.result.current[0]).toBe(false);
    } finally {
      window.removeEventListener(
        "hermes-inline-visualizations-changed",
        listener,
      );
    }
  });

  it("falls back off when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(readInlineVisualizations()).toBe(false);
    const { result } = renderHook(() => useInlineVisualizations());
    expect(result.current[0]).toBe(false);
  });

  it("states the fenced-HTML contract in one sentence group", () => {
    expect(INLINE_VISUALIZATION_PROMPT).toContain("```html");
    expect(INLINE_VISUALIZATION_PROMPT).toContain("sandboxed");
    expect(INLINE_VISUALIZATION_PROMPT).toContain("no external scripts");
  });
});
