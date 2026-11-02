import { act, cleanup, fireEvent, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { useUsageTracker, type UsageRecord } from "../Chat/hooks/useUsageTracker";
import Usage from "./Usage";

const entry = { provider: "custom", model: "m1", inputTokens: 10, outputTokens: 2, totalTokens: 12 };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Usage dashboard", () => {
  it("updates while mounted, refreshes local history, and confirms clearing", () => {
    const writer = renderHook(() => useUsageTracker());
    renderWithI18n(<Usage />);
    expect(screen.getByText("No token usage recorded yet.")).toBeInTheDocument();
    act(() => writer.result.current.recordUsage(entry));
    const table = screen.getByRole("table", { name: "Token usage records" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(writer.result.current.records).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear?" }));
    expect(writer.result.current.records).toHaveLength(0);
    expect(screen.getByText("No token usage recorded yet.")).toBeInTheDocument();
  });

  it("caps only the table, filters accurately, and never calls unknown context zero percent", () => {
    const records: UsageRecord[] = Array.from({ length: 105 }, (_, i) => ({
      ...entry, id: `r${i}`, timestamp: new Date(Date.UTC(2026, 10, 2, 0, 0, 105 - i)).toISOString(),
      model: i < 103 ? "m1" : "m2", contextMax: 200000,
    }));
    localStorage.setItem("hermes.usage.history.v1", JSON.stringify(records));
    renderWithI18n(<Usage />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(screen.getByText("100 of 105 records")).toBeInTheDocument();
    expect(within(table).queryByText("0%")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model:"), { target: { value: "m2" } });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("2 of 2 records")).toBeInTheDocument();
    expect(document.querySelector(".usage-stat--turns .usage-stat-value")).toHaveTextContent("105");
  });
});
