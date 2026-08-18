import { describe, expect, it } from "vitest";
import {
  isOfficialScrollAtBottom,
  jumpOfficialScrollToBottom,
  resolveOfficialScrollTarget,
} from "./useOfficialChatScroll";

describe("official chat scroll adapter", () => {
  it("accepts subpixel target differences", () => {
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "scrollTop", { value: 100, writable: true });
    expect(resolveOfficialScrollTarget(100.25, { scrollElement, contentElement: document.createElement("div") })).toBe(100);
    expect(resolveOfficialScrollTarget(101, { scrollElement, contentElement: document.createElement("div") })).toBe(101);
  });

  it("uses the same near-bottom tolerance as the chat UI", () => {
    expect(isOfficialScrollAtBottom({ scrollTop: 440, scrollHeight: 1000, clientHeight: 500 })).toBe(false);
    expect(isOfficialScrollAtBottom({ scrollTop: 490, scrollHeight: 1000, clientHeight: 500 })).toBe(true);
  });

  it("jumps to the current bottom without a stale height snapshot", () => {
    const element = { scrollTop: 10, scrollHeight: 1200, clientHeight: 500 };
    jumpOfficialScrollToBottom(element);
    expect(element.scrollTop).toBe(1200);
  });
});
