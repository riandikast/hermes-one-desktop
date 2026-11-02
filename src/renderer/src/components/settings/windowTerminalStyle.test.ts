// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWindowTerminalStyle } from "./windowTerminalStyle";

beforeEach(() => localStorage.clear());

describe("useWindowTerminalStyle", () => {
  it("defaults to dialog", () => {
    const { result } = renderHook(() => useWindowTerminalStyle());
    expect(result.current[0]).toBe("dialog");
  });

  it("persists changes and updates every mounted consumer", () => {
    const first = renderHook(() => useWindowTerminalStyle());
    const second = renderHook(() => useWindowTerminalStyle());

    act(() => {
      expect(first.result.current[1]("sidebar")).toBe(true);
    });

    expect(localStorage.getItem("hermes.windowTerminalStyle")).toBe("sidebar");
    expect(first.result.current[0]).toBe("sidebar");
    expect(second.result.current[0]).toBe("sidebar");
  });

  it("falls back to dialog for unknown saved values", () => {
    localStorage.setItem("hermes.windowTerminalStyle", "unsupported");
    const { result } = renderHook(() => useWindowTerminalStyle());
    expect(result.current[0]).toBe("dialog");
  });
});
