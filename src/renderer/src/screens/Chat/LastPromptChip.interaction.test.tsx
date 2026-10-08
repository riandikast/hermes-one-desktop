// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/renderWithI18n";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { LastPromptChip } from "./LastPromptChip";
import { createAtom } from "./hooks/useChatScrollAtoms";
import type { ChatBubbleMessage, ChatMessage } from "./types";

/**
 * Interaction coverage for the last-prompt chip.
 *
 * Clicking opens a dialog listing the RECENT prompts (newest first, runtime
 * injections excluded) rather than a single prompt — the chip's one newest row
 * is ambiguous when auto-notices arrived after it. Each row expands to its full
 * text and copies independently.
 */

const prompt = (id: string, content: string): ChatBubbleMessage => ({
  id,
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

function renderChip(messages: ReadonlyArray<ChatMessage>): void {
  renderWithI18n(
    <LastPromptChip
      messages={messages}
      containerRef={scrollContainer()}
      scrolledUpAtom={createAtom<boolean>(true)}
    />,
  );
}

const rowTexts = (): string[] =>
  Array.from(document.querySelectorAll(".chat-last-prompt-item")).map(
    (el) => el.textContent ?? "",
  );

const theChip = (): HTMLElement =>
  screen.getByRole("button", { name: /show full last prompt/i });

describe("LastPromptChip interaction", () => {
  it("lists the recent prompts, hiding the injected ones", async () => {
    renderChip([
      prompt("u1", "the real prompt"),
      { id: "a1", role: "agent", content: "answer" } as ChatMessage,
      prompt("i1", "[IMPORTANT: Background process proc_x completed"),
      prompt("i2", "[System: The active model has changed"),
      prompt("u2", "a newer prompt"),
    ]);

    act(() => {
      theChip().click();
    });

    const rows = rowTexts();
    expect(rows).toHaveLength(2);
    // Newest first, and neither injected row appears anywhere in the dialog.
    expect(rows[0]).toContain("a newer prompt");
    expect(rows[1]).toContain("the real prompt");
    expect(document.body.textContent).not.toContain("Background process");
    expect(document.body.textContent).not.toContain("active model has changed");
  });

  it("expands a row to its full prompt", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    renderChip([prompt("u1", long)]);

    act(() => {
      theChip().click();
    });

    // Collapsed by default: a one-line preview, not the whole blob.
    expect(document.querySelector(".chat-last-prompt-item-body")).toBeNull();

    const toggle = await screen.findByRole("button", {
      name: /^expand$/i,
    });
    act(() => {
      toggle.click();
    });

    // Expanded: every line, including the last the preview could not show.
    const body = document.querySelector(".chat-last-prompt-item-body");
    expect(body?.textContent).toBe(long);
    expect(body?.textContent).toContain("line 59");
  });

  it("does not open a dialog before the chip is clicked", async () => {
    renderChip([prompt("u1", "just a prompt")]);
    await screen.findByRole("button", { name: /show full last prompt/i });
    expect(document.querySelector(".chat-last-prompt-item")).toBeNull();
  });

  it("closes the dialog again via the close button", async () => {
    renderChip([prompt("u1", "close me")]);
    act(() => {
      theChip().click();
    });
    expect(rowTexts()).toHaveLength(1);

    const close = await screen.findByRole("button", {
      name: /close recent prompts/i,
    });
    act(() => {
      close.click();
    });
    expect(rowTexts()).toHaveLength(0);
  });

  it("keeps the chip visible while its dialog is open", async () => {
    const atom = createAtom<boolean>(true);
    renderWithI18n(
      <LastPromptChip
        messages={[prompt("u1", "stay put")]}
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

  it("truncates the pill text but never the expanded row", async () => {
    const long = "x".repeat(500);
    renderChip([prompt("u1", long)]);
    const chip = theChip();
    // Pill preview is capped...
    const preview = chip.querySelector(".chat-last-prompt-text")?.textContent;
    expect(preview?.length).toBeLessThan(long.length);
    expect(preview?.endsWith("…")).toBe(true);

    act(() => {
      chip.click();
    });
    act(() => {
      screen.getByRole("button", { name: /^expand$/i }).click();
    });
    // ...while the expanded row holds every character.
    expect(
      document.querySelector(".chat-last-prompt-item-body")?.textContent,
    ).toBe(long);
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

    it("copies the FULL text of the row it belongs to", async () => {
      const copySpy = stubClipboard();
      const long = "y".repeat(500);
      renderChip([prompt("u1", long)]);
      act(() => {
        theChip().click();
      });

      const copy = await screen.findByRole("button", {
        name: /copy prompt/i,
      });
      await act(async () => {
        copy.click();
      });

      expect(copySpy).toHaveBeenCalledTimes(1);
      // The whole prompt, not the truncated preview.
      expect(copySpy).toHaveBeenCalledWith(long);
    });

    it("copies only the row that was clicked", async () => {
      const copySpy = stubClipboard();
      renderChip([prompt("u1", "first prompt"), prompt("u2", "second prompt")]);
      act(() => {
        theChip().click();
      });

      // Row 1 is the newest ("second prompt"); row 2 is "first prompt".
      const second = await screen.findByRole("button", {
        name: /copy prompt 2/i,
      });
      await act(async () => {
        second.click();
      });

      expect(copySpy).toHaveBeenCalledTimes(1);
      expect(copySpy).toHaveBeenCalledWith("first prompt");
    });

    it("survives a clipboard failure without throwing", async () => {
      (window as unknown as { hermesAPI: unknown }).hermesAPI = {
        copyToClipboard: vi.fn(() => Promise.reject(new Error("denied"))),
      };
      renderChip([prompt("u1", "nope")]);
      act(() => {
        theChip().click();
      });
      const copy = await screen.findByRole("button", {
        name: /copy prompt/i,
      });
      await act(async () => {
        copy.click();
      });
      // Still shows the copy affordance; no unhandled rejection.
      expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
    });
  });
});
