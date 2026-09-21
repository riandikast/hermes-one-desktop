// @vitest-environment jsdom
//
// TerminalDialog: header dragging.
//
// The panel is centered by CSS and dragging applies a translate offset from
// that centre. These cover the parts that are easy to get wrong: the drag must
// not start on the close button (or the dialog becomes unclosable), the offset
// must be clamped so the panel cannot be dragged off-screen, and a reopened
// dialog recentres rather than restoring a position that may be off-view.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDialog } from "./TerminalDialog";

beforeEach(() => {
  // jsdom reports 1024x768 and has no pointer capture by default.
  Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

function renderDialog(): {
  panel: HTMLElement;
  header: HTMLElement;
  closeBtn: HTMLElement;
} {
  const { container } = render(
    <TerminalDialog open onClose={() => undefined} title="Term">
      <div data-testid="term" />
    </TerminalDialog>,
  );
  return {
    panel: container.querySelector<HTMLElement>(".terminal-dialog")!,
    header: container.querySelector<HTMLElement>(".terminal-dialog-head")!,
    closeBtn: container.querySelector<HTMLElement>(".terminal-dialog-close")!,
  };
}

function drag(
  header: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(header, { pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(header, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(header, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("TerminalDialog dragging", () => {
  it("starts centered with no offset", () => {
    const { panel } = renderDialog();
    expect(panel.style.transform).toBe("translate(0px, 0px)");
  });

  it("translates the panel as the header is dragged", () => {
    const { panel, header } = renderDialog();
    drag(header, { x: 400, y: 300 }, { x: 460, y: 340 });
    expect(panel.style.transform).toBe("translate(60px, 40px)");
  });

  it("accumulates across successive drags rather than resetting", () => {
    const { panel, header } = renderDialog();
    drag(header, { x: 400, y: 300 }, { x: 430, y: 320 });
    drag(header, { x: 430, y: 320 }, { x: 450, y: 360 });
    expect(panel.style.transform).toBe("translate(50px, 60px)");
  });

  it("does NOT start a drag from the close button", () => {
    // Otherwise the panel moves out from under the button and cannot be closed.
    const { panel, closeBtn } = renderDialog();
    fireEvent.pointerDown(closeBtn, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(closeBtn, { pointerId: 1, clientX: 500, clientY: 400 });
    expect(panel.style.transform).toBe("translate(0px, 0px)");
  });

  it("marks itself dragging while the pointer is down, then stops", () => {
    const { panel, header } = renderDialog();
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(panel.className).toContain("is-dragging");
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(panel.className).not.toContain("is-dragging");
  });

  it("clamps the offset so the panel cannot leave the viewport", () => {
    const { panel, header } = renderDialog();
    // Drag far beyond the window: the clamp keeps it reachable.
    drag(header, { x: 400, y: 300 }, { x: 9000, y: 9000 });
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
      panel.style.transform,
    )!;
    const [, x, y] = m;
    // Half the viewport is the widest a centered panel can travel.
    expect(Math.abs(Number(x))).toBeLessThanOrEqual(window.innerWidth / 2);
    expect(Math.abs(Number(y))).toBeLessThanOrEqual(window.innerHeight / 2);
  });

  it("recenters on double-click of the header", () => {
    const { panel, header } = renderDialog();
    drag(header, { x: 400, y: 300 }, { x: 500, y: 400 });
    expect(panel.style.transform).not.toBe("translate(0px, 0px)");
    fireEvent.doubleClick(header);
    expect(panel.style.transform).toBe("translate(0px, 0px)");
  });

  it("ignores move events that were never preceded by a pointerdown", () => {
    const { panel, header } = renderDialog();
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 500, clientY: 400 });
    expect(panel.style.transform).toBe("translate(0px, 0px)");
  });
});

describe("TerminalDialog reopen behaviour", () => {
  it("recenters on reopen so it cannot reappear off-screen", () => {
    const view = render(
      <TerminalDialog open onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    const panel = () =>
      view.container.querySelector<HTMLElement>(".terminal-dialog")!;
    const header = () =>
      view.container.querySelector<HTMLElement>(".terminal-dialog-head")!;

    drag(header(), { x: 400, y: 300 }, { x: 470, y: 360 });
    expect(panel().style.transform).toBe("translate(70px, 60px)");

    view.rerender(
      <TerminalDialog open={false} onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    view.rerender(
      <TerminalDialog open onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );

    expect(panel().style.transform).toBe("translate(0px, 0px)");
  });

  it("keeps the terminal mounted across close and reopen", () => {
    const view = render(
      <TerminalDialog open onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    view.rerender(
      <TerminalDialog open={false} onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    expect(screen.getByTestId("term")).toBeDefined();
  });
});
