// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { LastPromptChip } from "./LastPromptChip";
import { createAtom } from "./hooks/useChatScrollAtoms";
import type { ChatBubbleMessage } from "./types";

/**
 * Interaction coverage for the last-prompt chip.
 *
 * Clicking opens the FULL prompt in a dialog rather than scrolling the
 * transcript to it — a scroll-based jump was flaky because the target row can
 * be virtualised out of the DOM and the stick-to-bottom auto-follow fights a
 * programmatic scroll. A dialog always shows the complete prompt and scrolls
 * for very long ones.
 */

const prompt = (content: string): ChatBubbleMessage => ({
  id: "u1",
  role: "user",
  content,
});

/** A container with real overflow so the chip considers itself scrollable. */
function scrollContainer(): React.RefObject<HTMLDivElement | null> {
  const ref = createRef<HTMLDivElement>();
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", {
    value: 4000,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", { value: 800, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
  el.scrollTo = vi.fn();
  ref.current = el;
  return ref as React.RefObject<HTMLDivElement | null>;
}

function renderChip(content: string): void {
  render(
    <LastPromptChip
      messages={[prompt(content)]}
      containerRef={scrollContainer()}
      scrolledUpAtom={createAtom<boolean>(true)}
    />,
  );
}

const dialogBody = (): string | null =>
  document.querySelector(".chat-last-prompt-dialog-body")?.textContent ?? null;

describe("LastPromptChip interaction", () => {
  it("opens a dialog showing the FULL prompt when clicked", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    renderChip(long);

    const chip = await screen.findByRole("button", {
      name: /show full last prompt/i,
    });
    act(() => {
      chip.click();
    });

    // The dialog body carries the WHOLE prompt, including the final line the
    // one-line pill could never show.
    expect(dialogBody()).toBe(long);
    expect(dialogBody()).toContain("line 59");
  });

  it("does not open a dialog before the chip is clicked", async () => {
    renderChip("just a prompt");
    await screen.findByRole("button", { name: /show full last prompt/i });
    expect(dialogBody()).toBeNull();
  });

  it("closes the dialog again via the close button", async () => {
    renderChip("close me");
    act(() => {
      screen.getByRole("button", { name: /show full last prompt/i }).click();
    });
    expect(dialogBody()).not.toBeNull();

    const close = await screen.findByRole("button", {
      name: /close last prompt/i,
    });
    act(() => {
      close.click();
    });
    expect(dialogBody()).toBeNull();
  });

  it("keeps the chip visible while its dialog is open", async () => {
    const atom = createAtom<boolean>(true);
    render(
      <LastPromptChip
        messages={[prompt("stay put")]}
        containerRef={scrollContainer()}
        scrolledUpAtom={atom}
      />,
    );
    const chip = await screen.findByRole("button", {
      name: /show full last prompt/i,
    });
    act(() => {
      chip.click();
    });
    // The scrolled-up flag clearing must not hide the chip, or the dialog would
    // vanish from under the user.
    act(() => {
      atom.set(false);
    });
    expect(chip.className).toContain("chat-last-prompt--visible");
  });

  it("truncates the pill text but never the dialog", async () => {
    const long = "x".repeat(500);
    renderChip(long);
    const chip = await screen.findByRole("button", {
      name: /show full last prompt/i,
    });
    // Pill preview is capped...
    const preview = chip.querySelector(".chat-last-prompt-text")?.textContent;
    expect(preview?.length).toBeLessThan(long.length);
    expect(preview?.endsWith("…")).toBe(true);

    act(() => {
      chip.click();
    });
    // ...while the dialog holds every character.
    expect(dialogBody()).toBe(long);
  });

  describe("copy button", () => {
    /** Install a clipboard stub and return the spy it writes to. */
    function stubClipboard(): ReturnType<typeof vi.fn> {
      const copyToClipboard = vi.fn(() => Promise.resolve());
      (window as unknown as { hermesAPI: unknown }).hermesAPI = {
        copyToClipboard,
      };
      return copyToClipboard;
    }

    it("copies the FULL prompt, not the truncated pill", async () => {
      const copySpy = stubClipboard();
      const long = "y".repeat(500);
      renderChip(long);
      act(() => {
        screen.getByRole("button", { name: /show full last prompt/i }).click();
      });

      const copy = await screen.findByRole("button", {
        name: /copy prompt/i,
      });
      await act(async () => {
        copy.click();
      });

      expect(copySpy).toHaveBeenCalledTimes(1);
      expect(copySpy).toHaveBeenCalledWith(long);
    });

    it("shows a Copied acknowledgement, then reverts", async () => {
      stubClipboard();
      renderChip("copy me");
      act(() => {
        screen.getByRole("button", { name: /show full last prompt/i }).click();
      });
      // The copy control appears once the dialog is open.
      const copy = await screen.findByRole("button", { name: /copy prompt/i });
      await act(async () => {
        copy.click();
      });

      // Re-labelled while the acknowledgement is up.
      expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy();

      // Reverts after the ack window. Real timers + a bounded wait keeps this
      // honest about the actual delay without freezing the poller.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2100));
      });
      expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
    }, 10000);

    it("survives a clipboard failure without throwing", async () => {
      (window as unknown as { hermesAPI: unknown }).hermesAPI = {
        copyToClipboard: vi.fn(() => Promise.reject(new Error("denied"))),
      };
      renderChip("nope");
      act(() => {
        screen.getByRole("button", { name: /show full last prompt/i }).click();
      });
      const copy = await screen.findByRole("button", { name: /copy prompt/i });
      await act(async () => {
        copy.click();
      });
      // No "Copied" acknowledgement on failure, and no unhandled rejection.
      expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
    }, 10000);
  });
});
