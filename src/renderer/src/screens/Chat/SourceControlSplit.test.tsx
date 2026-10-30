import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SourceControlSplit } from "./SourceControlSplit";

it("clamps drag and keyboard widths, stops after pointer cancellation", () => {
  const { container } = render(<SourceControlSplit label="Test width"><div>Left</div><div>Right</div></SourceControlSplit>);
  const handle = screen.getByRole("separator", { name: "Test width" });
  const host = container.firstElementChild as HTMLElement;
  host.getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
  handle.setPointerCapture = vi.fn();
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle).toHaveAttribute("aria-valuenow", "20");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle).toHaveAttribute("aria-valuenow", "20");
  fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  fireEvent(handle, new MouseEvent("pointermove", { bubbles: true, clientX: 1000 }));
  expect(handle).toHaveAttribute("aria-valuenow", "80");
  fireEvent(handle, new MouseEvent("pointercancel", { bubbles: true }));
  fireEvent(handle, new MouseEvent("pointermove", { bubbles: true, clientX: 200 }));
  expect(handle).toHaveAttribute("aria-valuenow", "80");
});
