import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextGauge } from "./ContextGauge";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: { used?: string; total?: string }) =>
      key === "chat.contextTokens" ? `${values?.used} / ${values?.total}` : key === "chat.contextCompact" ? "Compress Context (/compact)" : key === "chat.contextNewSession" ? "New session with context" : key,
  }),
}));

describe("context usage counter", () => {
  it("shows current occupancy percent and exposes actions by keyboard/touch", async () => {
    const compact = vi.fn();
    const fresh = vi.fn();
    render(
      <ContextGauge
        used={25000}
        window={100000}
        estimated={false}
        onCompact={compact}
        onNewSessionWithContext={fresh}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Context usage:.*25%/ });
    expect(trigger.tagName).toBe("BUTTON");
    expect(screen.getByText("25").className).toBe("chat-ctx-gauge-num");
    expect(trigger.querySelector("svg")?.getAttribute("width")).toBe("26");
    expect(screen.queryByText("25%")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("25k / 100k")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Compress Context (/compact)")); });
    fireEvent.click(screen.getByText("New session with context"));
    expect(compact).toHaveBeenCalledOnce();
    expect(fresh).toHaveBeenCalledOnce();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows compaction progress and prevents repeat clicks until the command finishes", async () => {
    let finish!: () => void;
    const compact = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ContextGauge used={25000} window={100000} onCompact={compact} />);
    fireEvent.click(screen.getByText("Compress Context (/compact)"));
    const pending = screen.getByRole("button", { name: "chat.contextCompacting" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(compact).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Compress Context (/compact)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("labels a heuristic model limit separately from the occupancy estimate", () => {
    render(<ContextGauge used={25000} window={131072} limitEstimated />);
    expect(screen.getByText("chat.contextLimitEstimated")).toBeTruthy();
  });

  it("mounts settings only on explicit open, removes on Escape", () => {
    render(<ContextGauge used={0} window={100000} settings={<div>settings content</div>} />);
    expect(screen.queryByText("settings content")).toBeNull();
    const trigger = screen.getByRole("button", { name: /Context usage/ });
    fireEvent.click(trigger);
    expect(screen.getByText("settings content")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText("settings content")).toBeNull();
  });

  it("labels estimates and preserves known zero occupancy", () => {
    render(<ContextGauge used={0} window={100000} />);
    expect(
      screen.getByRole("button", { name: "Context usage: estimated 0%" }),
    ).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("chat.contextWindow (estimated)")).toBeTruthy();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid model limit %s",
    (window) => {
      render(<ContextGauge used={500} window={window} />);
      expect(
        screen.getByRole("button", { name: "Context usage: unknown" }),
      ).toBeTruthy();
    },
  );

  it("does not present an unknown denominator as zero percent", () => {
    render(<ContextGauge used={500} window={0} />);
    expect(
      screen.getByRole("button", { name: /Context usage: unknown/ }),
    ).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });
});
