import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FloatingDialog } from "./FloatingDialog";

it("renders the attach toggle only for callers that opt in", () => {
  const view = render(
    <FloatingDialog open onClose={() => undefined} title="Terminal">
      <div />
    </FloatingDialog>,
  );
  expect(screen.queryByRole("button", { name: /Attach/ })).toBeNull();
  view.unmount();
});

it("toggles between floating and an attached side pane", () => {
  const toggle = vi.fn();
  const view = render(
    <FloatingDialog
      open
      onClose={() => undefined}
      title="Web preview"
      placementDocked={false}
      onTogglePlacement={toggle}
    >
      <div />
    </FloatingDialog>,
  );
  const attach = screen.getByRole("button", {
    name: "Attach Web preview to this chat",
  });
  expect(attach.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(attach);
  expect(toggle).toHaveBeenCalledOnce();

  view.rerender(
    <FloatingDialog
      open
      onClose={() => undefined}
      title="Web preview"
      placement="sidebar"
      placementDocked
      onTogglePlacement={toggle}
    >
      <div />
    </FloatingDialog>,
  );
  expect(view.container.querySelector(".terminal-dialog-overlay.is-sidebar")).toBeTruthy();
  expect(view.container.querySelector(".terminal-dialog--sidebar")).toBeTruthy();
  const detach = screen.getByRole("button", {
    name: "Float Web preview in a window",
  });
  expect(detach.getAttribute("aria-pressed")).toBe("true");
});
