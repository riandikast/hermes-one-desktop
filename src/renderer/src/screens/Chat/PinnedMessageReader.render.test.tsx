// @vitest-environment jsdom

import { renderWithI18n } from "../../test/renderWithI18n";
import { describe, expect, it } from "vitest";
import { PinnedMessageReader } from "./MessageList";
import type { ChatBubbleMessage } from "./types";

/**
 * The pinned-message reader must render a body element that carries the PANEL
 * class. Reported as "container bg doesnt work" — the container was rendered but
 * invisible because the panel colour resolved to the dialog's own colour.
 *
 * This pins the parts that live in the component (the class must be present and
 * must be the one the CSS panel rule selects), plus the collapse bug: the body
 * used to carry `flex: 1` + `min-height: 0`, which zero-heighted it so no
 * background could show. Geometry is CSS and cannot be measured in jsdom, so
 * the CSS side of that is pinned in chatWiring.test.ts against the stylesheet.
 */

const message = (content: string): ChatBubbleMessage => ({
  id: "m1",
  role: "user",
  content,
});

describe("PinnedMessageReader body", () => {
  it("renders the body with the class the panel rule selects", () => {
    const { container } = renderWithI18n(
      <PinnedMessageReader message={message("a pinned prompt")} onClose={() => {}} />,
    );
    const body = container.querySelector(".chat-last-prompt-dialog-body");
    expect(body).not.toBeNull();
    // It is also the highlighted-text host, so both classes must coexist.
    expect(body?.className).toContain("chat-hl-text");
    expect(body?.textContent).toContain("a pinned prompt");
  });

  it("renders nothing when there is no message", () => {
    const { container } = renderWithI18n(
      <PinnedMessageReader message={null} onClose={() => {}} />,
    );
    expect(container.querySelector(".chat-last-prompt-dialog-body")).toBeNull();
  });

  it("wraps the body in the dialog panel (not bare on the overlay)", () => {
    const { container } = renderWithI18n(
      <PinnedMessageReader message={message("x")} onClose={() => {}} />,
    );
    // The panel class the .last-prompt-dialog rule paints lives on the panel,
    // and the body must be INSIDE it — a body outside the panel would sit on the
    // overlay instead and look unstyled.
    const panel = container.querySelector(".last-prompt-dialog");
    expect(panel).not.toBeNull();
    expect(panel?.querySelector(".chat-last-prompt-dialog-body")).not.toBeNull();
  });
});
