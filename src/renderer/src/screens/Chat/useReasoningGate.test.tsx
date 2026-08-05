import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markReasoningGrowth, markReasoningReveal } from "./reasoningStall";
import { useReasoningGate } from "./useReasoningGate";

function Gate({
  waitForReasoningId,
  hasContent,
  isLoading,
}: {
  waitForReasoningId?: string;
  hasContent: boolean;
  isLoading: boolean;
}): React.JSX.Element {
  const { waiting } = useReasoningGate({
    waitForReasoningId,
    hasContent,
    isLoading,
  });
  return <div data-testid="row">{waiting ? "hidden" : "shown"}</div>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useReasoningGate", () => {
  it("shows immediately when there is no preceding reasoning to wait for", () => {
    const { getByTestId } = render(<Gate hasContent isLoading={true} />);
    expect(getByTestId("row").textContent).toBe("shown");
  });

  it("shows when there is no content to gate", () => {
    const { getByTestId } = render(
      <Gate
        waitForReasoningId="reasoning-empty"
        hasContent={false}
        isLoading={true}
      />,
    );
    expect(getByTestId("row").textContent).toBe("shown");
  });

  it("hides until the preceding thought stops growing and fully reveals, then shows", () => {
    // Unique id so module-scope state can't leak between tests.
    markReasoningGrowth("reasoning-active"); // stalledMs starts at 0
    markReasoningReveal("reasoning-active", 0, 100); // typewriter behind
    const { getByTestId } = render(
      <Gate
        waitForReasoningId="reasoning-active"
        hasContent
        isLoading={true}
      />,
    );
    expect(getByTestId("row").textContent).toBe("hidden");

    // Thought stops growing (>1200ms ago) and the typewriter catches up.
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    markReasoningReveal("reasoning-active", 100, 100);
    act(() => {
      vi.advanceTimersByTime(300); // let the 250ms poll fire
    });
    expect(getByTestId("row").textContent).toBe("shown");
  });

  it("never re-hides once the gate has opened", () => {
    markReasoningGrowth("reasoning-once", Date.now() - 2000); // already settled
    markReasoningReveal("reasoning-once", 50, 50); // already complete
    const { getByTestId, rerender } = render(
      <Gate waitForReasoningId="reasoning-once" hasContent isLoading={true} />,
    );
    expect(getByTestId("row").textContent).toBe("shown");

    // More reasoning deltas arrive later — the gate must not re-close.
    markReasoningGrowth("reasoning-once");
    markReasoningReveal("reasoning-once", 0, 100);
    rerender(
      <Gate waitForReasoningId="reasoning-once" hasContent isLoading={true} />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getByTestId("row").textContent).toBe("shown");
  });
});
