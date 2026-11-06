import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useReasoningEffort } from "./useReasoningEffort";
import { writeDefaultReasoning } from "../../../components/settings/defaultReasoning";

beforeEach(() => localStorage.clear());

it("starts a chat that has no pick of its own at the Providers default", () => {
  writeDefaultReasoning("high");
  const { result } = renderHook(() => useReasoningEffort("default", null, "fresh-draft"));
  expect(result.current.reasoningEffort).toBe("high");
});

it("keeps an explicit per-chat pick when the profile default changes later", async () => {
  writeDefaultReasoning("low");
  const { result } = renderHook(() => useReasoningEffort("default", "stored-a", "reopened"));
  await act(async () => { await result.current.setReasoningEffort("max"); });
  writeDefaultReasoning("ultra");
  const { result: reopened } = renderHook(() => useReasoningEffort("default", "stored-a", "reopened"));
  expect(reopened.current.reasoningEffort).toBe("max");
});

it("falls back to Auto when the chat's stored pick is corrupt", () => {
  localStorage.setItem(
    JSON.stringify(["hermes.chat.reasoning.v1", "default", "corrupt"]),
    "enormous",
  );
  const { result } = renderHook(() => useReasoningEffort("default", "corrupt"));
  expect(result.current.reasoningEffort).toBe("auto");
});
