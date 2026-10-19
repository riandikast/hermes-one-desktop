import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub i18n so the row renders in isolation; keys come back verbatim.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: vi.fn() }),
}));

import { ReasoningRow } from "./HistoryRow";
import {
  reasoningRevealComplete,
  reasoningStalledMs,
} from "./reasoningStall";
import type { ReasoningMessage } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRow(over: Partial<ReasoningMessage> = {}): ReasoningMessage {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    kind: "reasoning",
    role: "agent",
    text: "thought chunk one",
    ...over,
  } as ReasoningMessage;
}

describe("ReasoningRow gate stamps", () => {
  it("on a LIVE mount, stamps growth and reports all received text as revealed", () => {
    const msg = makeRow();
    render(
      <ReasoningRow msg={msg} active showAvatar={false} />,
    );
    // Growth still holds the settle gate; there is no cosmetic reveal backlog.
    expect(reasoningStalledMs(msg.id)).toBeLessThan(1000);
    expect(reasoningRevealComplete(msg.id)).toBe(true);
  });

  it("on a history (active=false) mount, stamps no growth and reports the reveal complete so the gate opens instantly", () => {
    const msg = makeRow();
    render(
      <ReasoningRow msg={msg} active={false} showAvatar={false} />,
    );
    // No growth stamp (stalledMs = MAX) and full text shown (reveal complete)
    // — history rows don't animate, the gate short-circuits.
    expect(reasoningStalledMs(msg.id)).toBe(Number.MAX_SAFE_INTEGER);
    expect(reasoningRevealComplete(msg.id)).toBe(true);
  });
});