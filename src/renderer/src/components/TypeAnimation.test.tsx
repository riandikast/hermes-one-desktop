import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypeAnimation } from "./TypeAnimation";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TypeAnimation", () => {
  it("shows the full text instantly when inactive", () => {
    const { container } = render(
      <TypeAnimation text="hello world" active={false} />,
    );
    expect(container.textContent).toBe("hello world");
  });

  it("types at the configured rate while active", () => {
    const { container } = render(
      <TypeAnimation text="abcdefghij" active charsPerSecond={100} />,
    );
    act(() => {
      vi.advanceTimersByTime(150); // 3 ticks at 50ms each → 15 chars revealed
    });
    expect(container.textContent).toBe("abcdefghij");
  });

  it("reveals a fraction of long text per tick (no 20 cps cap)", () => {
    const text = "x".repeat(100);
    const { container } = render(
      <TypeAnimation text={text} active charsPerSecond={100} />,
    );
    act(() => {
      vi.advanceTimersByTime(100); // 2 ticks → 10 chars revealed
    });
    expect(container.textContent?.length).toBeGreaterThanOrEqual(10);
    expect(container.textContent?.length).toBeLessThan(100);
  });

  it("finishes the reveal and stops the timer", () => {
    const { container } = render(
      <TypeAnimation text="ab" active charsPerSecond={36} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toBe("ab");
  });

  it("reveals long text within the max duration cap", () => {
    const text = "x".repeat(600);
    const { container } = render(
      <TypeAnimation
        text={text}
        active
        charsPerSecond={100}
        maxDurationMs={300}
      />,
    );
    // 600 chars over 300ms → 100 chars per 50ms tick (well above the 5-char
    // cadence floor, so the cap dominates).
    act(() => {
      vi.advanceTimersByTime(100); // 2 ticks → 200 chars
    });
    expect(container.textContent?.replaceAll("▍", "").length).toBe(200);
    act(() => {
      vi.advanceTimersByTime(200); // 4 more ticks → all 600
    });
    expect(container.textContent).toBe(text);
  });

  it("caps the per-tick reveal with maxCharsPerTick", () => {
    const text = "x".repeat(600);
    const { container } = render(
      <TypeAnimation
        text={text}
        active
        charsPerSecond={100}
        maxDurationMs={300}
        maxCharsPerTick={20}
      />,
    );
    // The 300ms budget alone would demand 100 chars per 50ms tick; the
    // ceiling bounds each tick to a readable 20-char burst.
    act(() => {
      vi.advanceTimersByTime(100); // 2 ticks → 40 chars, not 200
    });
    expect(container.textContent?.replaceAll("▍", "").length).toBe(40);
  });

  it("resumes from the revealed count when text grows mid-animation", () => {
    const { container, rerender } = render(
      <TypeAnimation text="abcdef" active charsPerSecond={100} />,
    );
    act(() => {
      vi.advanceTimersByTime(50); // 1 tick → 5 chars revealed
    });
    expect(container.textContent).toContain("abcde");

    rerender(
      <TypeAnimation text="abcdefghij" active charsPerSecond={100} />,
    );
    // The reveal continues from the revealed count — it never restarts.
    expect(container.textContent).toContain("abcde");
    expect(container.textContent).not.toContain("abcdef");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.textContent).toBe("abcdefghij");
  });
});
