import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
  readDefaultReasoning,
  useDefaultReasoning,
  writeDefaultReasoning,
} from "./defaultReasoning";

beforeEach(() => localStorage.clear());

it("defaults to Auto when nothing was chosen", () => {
  expect(readDefaultReasoning()).toBe("auto");
  const { result } = renderHook(() => useDefaultReasoning());
  expect(result.current[0]).toBe("auto");
});

it("persists a chosen tier and notifies mounted readers", () => {
  const { result } = renderHook(() => useDefaultReasoning());
  act(() => expect(writeDefaultReasoning("high")).toBe(true));
  expect(localStorage.getItem("hermes.reasoning.default")).toBe("high");
  expect(result.current[0]).toBe("high");
  expect(readDefaultReasoning()).toBe("high");
});

it("rejects unknown stored values instead of sending them to the gateway", () => {
  localStorage.setItem("hermes.reasoning.default", "turbo");
  expect(readDefaultReasoning()).toBe("auto");
  expect(writeDefaultReasoning("turbo" as never)).toBe(true);
  expect(localStorage.getItem("hermes.reasoning.default")).toBe("auto");
});

it("keeps every shared tier selectable, including Off and Ultra", () => {
  for (const tier of ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
    expect(writeDefaultReasoning(tier)).toBe(true);
    expect(readDefaultReasoning()).toBe(tier);
  }
});
