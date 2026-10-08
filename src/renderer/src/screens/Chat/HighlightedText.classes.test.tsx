// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightedText } from "./HighlightedText";

/**
 * Both readers must show the same PANEL container. Two independent bugs made
 * one of them miss it:
 *
 *  1. the last-prompt list renders a DIFFERENT element when collapsed
 *     (`.chat-last-prompt-item-preview`) than when expanded
 *     (`.chat-last-prompt-item-body`), so a panel declared only on the body
 *     appeared on expand but not before;
 *  2. the pinned-message reader passes its body class through `className` into
 *     HighlightedText, which ALSO adds `.chat-hl-text` — so the class the panel
 *     rule keys on must survive alongside the token class.
 *
 * These pin the RENDERED class list, which is what the CSS rules select.
 */

describe("HighlightedText class list", () => {
  it("keeps the caller's class alongside the token class (pinned reader)", () => {
    const { container } = render(
      <HighlightedText
        text="hello"
        tone="message"
        className="chat-last-prompt-dialog-body"
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    // The panel rule selects .chat-last-prompt-dialog-body; the token colours
    // select .chat-hl-text. Losing either breaks one feature silently.
    expect(pre?.className).toContain("chat-last-prompt-dialog-body");
    expect(pre?.className).toContain("chat-hl-text");
    expect(pre?.className).toContain("chat-hl-text--message");
  });

  it("keeps the caller's class for the last-prompt row too", () => {
    const { container } = render(
      <HighlightedText
        text="hello"
        tone="prompt"
        className="chat-last-prompt-item-body"
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("chat-last-prompt-item-body");
    expect(pre?.className).toContain("chat-hl-text--prompt");
  });

  it("renders without a caller class (no trailing space / 'undefined')", () => {
    const { container } = render(<HighlightedText text="hi" />);
    const cls = container.querySelector("pre")?.className ?? "";
    expect(cls).toContain("chat-hl-text");
    expect(cls).not.toContain("undefined");
    expect(cls).toBe(cls.trim());
  });
});
