// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FloatingDialog } from "./FloatingDialog";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

function measure(panel: HTMLElement): void {
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 80,
    width: 600,
    height: 400,
    right: 700,
    bottom: 480,
    x: 100,
    y: 80,
    toJSON: () => ({}),
  });
}

it("resizes from the bottom-left corner, keeping the right edge in place", () => {
  render(
    <FloatingDialog open title="Terminal" onClose={() => {}}>
      <div />
    </FloatingDialog>,
  );
  const panel = screen.getByRole("dialog");
  measure(panel);
  const handle = screen.getByRole("button", {
    name: "Resize Terminal from the left",
  });
  fireEvent.pointerDown(handle, { pointerId: 7, clientX: 700, clientY: 480 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 650, clientY: 530 });
  expect(panel.style.width).toBe("650px");
  expect(panel.style.height).toBe("450px");
  // The centre moves half the width delta, opposite sign to the right handle.
  expect(panel.style.transform).toBe("translate(-25px, 25px)");
  fireEvent.pointerUp(handle, { pointerId: 7 });
});

it("grows from the left edge with the keyboard", () => {
  render(
    <FloatingDialog open title="Terminal" onClose={() => {}}>
      <div />
    </FloatingDialog>,
  );
  const panel = screen.getByRole("dialog");
  measure(panel);
  const handle = screen.getByRole("button", {
    name: "Resize Terminal from the left",
  });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(panel.style.width).toBe("616px");
  expect(panel.style.transform).toBe("translate(-8px, 0px)");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(panel.style.width).toBe("584px");
  // Already offset by -8 from the growing step, so shrinking lands back centred.
  expect(panel.style.transform).toBe("translate(0px, 0px)");
});

it("offers both corner handles on dialogs but not on sidebar panels", () => {
  const view = render(
    <FloatingDialog open title="Web preview" onClose={() => {}}>
      <div />
    </FloatingDialog>,
  );
  expect(screen.getByRole("button", { name: "Resize Web preview" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Resize Web preview from the left" }),
  ).toBeTruthy();
  view.rerender(
    <FloatingDialog open placement="sidebar" title="Web preview" onClose={() => {}}>
      <div />
    </FloatingDialog>,
  );
  expect(screen.queryByRole("button", { name: "Resize Web preview" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Resize Web preview from the left" }),
  ).toBeNull();
});
