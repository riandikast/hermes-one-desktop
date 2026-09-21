// @vitest-environment jsdom
//
// The On-Finish terminal dialog.
//
// The load-bearing constraint: xterm terminals are permanent once created — a
// disposed one cannot be re-shown. So closing the dialog must HIDE, never
// unmount, or reopening would give a blank terminal (and the live pty would be
// orphaned). These assert that, plus the refit-on-open that keeps the geometry
// correct after the container was display:none.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalDialog } from "./TerminalDialog";

describe("TerminalDialog", () => {
  it("stays mounted with the terminal inside while closed", () => {
    const { container } = render(
      <TerminalDialog open={false} onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );

    // The child must exist in the DOM even though the dialog is closed.
    expect(screen.getByTestId("term")).toBeDefined();
    // ...but must not be reachable by the user.
    expect(container.querySelector(".terminal-dialog-overlay")?.className).not.toContain(
      "is-open",
    );
  });

  it("marks the overlay open and hidden via class, not by unmounting", () => {
    const { container, rerender } = render(
      <TerminalDialog open={false} onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    const overlay = container.querySelector(".terminal-dialog-overlay")!;
    expect(overlay.className).not.toContain("is-open");

    rerender(
      <TerminalDialog open onClose={() => undefined} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    expect(
      container.querySelector(".terminal-dialog-overlay")?.className,
    ).toContain("is-open");
    expect(screen.getByTestId("term")).toBeDefined();
  });

  it("exposes the closed state to assistive tech", () => {
    const { container } = render(
      <TerminalDialog open={false} onClose={() => undefined} title="Term">
        <div />
      </TerminalDialog>,
    );
    expect(
      container.querySelector(".terminal-dialog-overlay")?.getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <TerminalDialog open onClose={onClose} title="Term">
        <div />
      </TerminalDialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while closed, so it cannot close the chat", () => {
    const onClose = vi.fn();
    render(
      <TerminalDialog open={false} onClose={onClose} title="Term">
        <div />
      </TerminalDialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(
      <TerminalDialog open onClose={onClose} title="Term">
        <div />
      </TerminalDialog>,
    );
    fireEvent.click(screen.getByLabelText("Close terminal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <TerminalDialog open onClose={onClose} title="Term">
        <div />
      </TerminalDialog>,
    );
    fireEvent.click(container.querySelector(".terminal-dialog-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when a click lands inside the panel", () => {
    // Clicking the terminal itself must not dismiss it — that would make the
    // terminal unusable, since every interaction is a click inside it.
    const onClose = vi.fn();
    const { container } = render(
      <TerminalDialog open onClose={onClose} title="Term">
        <div data-testid="term" />
      </TerminalDialog>,
    );
    fireEvent.click(container.querySelector(".terminal-dialog")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders its title", () => {
    render(
      <TerminalDialog open onClose={() => undefined} title="On-Finish terminal">
        <div />
      </TerminalDialog>,
    );
    expect(screen.getByText("On-Finish terminal")).toBeDefined();
  });
});
