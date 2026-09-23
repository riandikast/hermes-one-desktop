// @vitest-environment jsdom
//
// Two gaps closed here:
//  1. When the agent offered choices, the card previously showed ONLY those
//     buttons — a custom answer was impossible. Other harnesses allow one.
//  2. A skip (or answer) the gateway never acknowledged left the turn spinning
//     for up to 5 minutes. It must now end the turn with a visible notice.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClarifyCard } from "./ClarifyCard";
import type { ClarifyMessage } from "./types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function msg(partial: Partial<ClarifyMessage> = {}): ClarifyMessage {
  return {
    id: "c1",
    kind: "clarify",
    role: "agent",
    requestId: "req-1",
    question: "Which database?",
    choices: [],
    ...partial,
  } as ClarifyMessage;
}

beforeEach(() => {
  (window as any).hermesAPI = { setWindowAttention: vi.fn(async () => {}) };
});

describe("ClarifyCard — custom answers alongside choices", () => {
  it("renders the agent's choices as buttons", () => {
    render(
      <ClarifyCard
        msg={msg({ choices: ["Postgres", "SQLite"] })}
        onResolved={vi.fn()}
      />,
    );
    expect(screen.getByText("Postgres")).toBeTruthy();
    expect(screen.getByText("SQLite")).toBeTruthy();
  });

  it("ALSO renders a textarea when choices were offered", () => {
    render(
      <ClarifyCard
        msg={msg({ choices: ["Postgres", "SQLite"] })}
        onResolved={vi.fn()}
      />,
    );
    // The regression: the textarea used to be in the else-branch only.
    expect(document.querySelector(".chat-clarify-textarea")).not.toBeNull();
    expect(screen.getByText("chat.clarify.orOwn")).toBeTruthy();
  });

  it("submits a CUSTOM answer even though choices exist", async () => {
    const onRespond = vi.fn(async () => true);
    const onResolved = vi.fn();
    render(
      <ClarifyCard
        msg={msg({ choices: ["Postgres", "SQLite"] })}
        onResolved={onResolved}
        onRespond={onRespond}
      />,
    );

    const textarea = document.querySelector(
      ".chat-clarify-textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "MySQL 8" } });
    await act(async () => {
      fireEvent.click(screen.getByText("chat.clarify.send"));
    });

    expect(onRespond).toHaveBeenCalledWith("req-1", "MySQL 8");
    expect(onResolved).toHaveBeenCalledWith("req-1", "MySQL 8");
  });

  it("renders the textarea with no choices (unchanged behaviour)", () => {
    render(<ClarifyCard msg={msg()} onResolved={vi.fn()} />);
    expect(document.querySelector(".chat-clarify-textarea")).not.toBeNull();
    expect(screen.queryByText("chat.clarify.orOwn")).toBeNull();
  });
});

describe("ClarifyCard — stuck-answer recovery", () => {
  it("reports a skip the gateway never acknowledges", async () => {
    vi.useFakeTimers();
    try {
      // `onRespond` never resolves — mirrors the gateway hanging on an empty
      // answer (the reported "stuck after skip" bug).
      const onRespond = vi.fn(() => new Promise<boolean>(() => {}));
      const onStuck = vi.fn();
      render(
        <ClarifyCard
          msg={msg()}
          onResolved={vi.fn()}
          onRespond={onRespond}
          onStuck={onStuck}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText("chat.clarify.skip"));
      });
      expect(onStuck).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(onStuck).toHaveBeenCalledWith("req-1", "");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT report stuck when the answer is accepted", async () => {
    vi.useFakeTimers();
    try {
      const onRespond = vi.fn(async () => true);
      const onStuck = vi.fn();
      const onResolved = vi.fn();
      render(
        <ClarifyCard
          msg={msg()}
          onResolved={onResolved}
          onRespond={onRespond}
          onStuck={onStuck}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText("chat.clarify.skip"));
      });
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onResolved).toHaveBeenCalled();
      expect(onStuck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flags the taskbar while waiting and clears it on resolve", () => {
    const { unmount } = render(<ClarifyCard msg={msg()} onResolved={vi.fn()} />);
    expect(window.hermesAPI.setWindowAttention).toHaveBeenCalledWith(true);
    unmount();
    expect(window.hermesAPI.setWindowAttention).toHaveBeenCalledWith(false);
  });

  it("never flashes once the card is already resolved", () => {
    render(
      <ClarifyCard
        msg={msg({ resolved: true, answer: "Postgres" })}
        onResolved={vi.fn()}
      />,
    );
    expect(window.hermesAPI.setWindowAttention).not.toHaveBeenCalled();
  });
});
