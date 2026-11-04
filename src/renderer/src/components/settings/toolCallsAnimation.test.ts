// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readToolCallsAnimation,
  useToolCallsAnimation,
} from "./toolCallsAnimation";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useToolCallsAnimation", () => {
  it("defaults off and enables only an explicitly saved true", () => {
    expect(readToolCallsAnimation()).toBe(false);
    const { result } = renderHook(() => useToolCallsAnimation());
    expect(result.current[0]).toBe(false);

    localStorage.setItem("hermes.toolCallsAnimation", "true");
    expect(readToolCallsAnimation()).toBe(true);
    localStorage.setItem("hermes.toolCallsAnimation", "false");
    expect(readToolCallsAnimation()).toBe(false);
    localStorage.setItem("hermes.toolCallsAnimation", "invalid");
    expect(readToolCallsAnimation()).toBe(false);
  });

  it("reads the persisted preference when mounting", () => {
    localStorage.setItem("hermes.toolCallsAnimation", "true");
    const { result } = renderHook(() => useToolCallsAnimation());
    expect(result.current[0]).toBe(true);
  });

  it("persists changes and broadcasts to every mounted consumer", () => {
    const first = renderHook(() => useToolCallsAnimation());
    const second = renderHook(() => useToolCallsAnimation());
    const listener = vi.fn();
    window.addEventListener("hermes-tool-calls-animation-changed", listener);
    try {
      act(() => {
        expect(first.result.current[1](true)).toBe(true);
      });
      expect(localStorage.getItem("hermes.toolCallsAnimation")).toBe("true");
      expect(first.result.current[0]).toBe(true);
      expect(second.result.current[0]).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      act(() => {
        expect(second.result.current[1](false)).toBe(true);
      });
      expect(localStorage.getItem("hermes.toolCallsAnimation")).toBe("false");
      expect(first.result.current[0]).toBe(false);
      expect(second.result.current[0]).toBe(false);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(
        "hermes-tool-calls-animation-changed",
        listener,
      );
    }
  });

  it("falls back off when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(readToolCallsAnimation()).toBe(false);
    const { result } = renderHook(() => useToolCallsAnimation());
    expect(result.current[0]).toBe(false);
  });

  it("reports failed writes without changing consumers or broadcasting", () => {
    const { result } = renderHook(() => useToolCallsAnimation());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const dispatch = vi.spyOn(window, "dispatchEvent");
    act(() => {
      expect(result.current[1](true)).toBe(false);
    });
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("hermes.toolCallsAnimation")).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
