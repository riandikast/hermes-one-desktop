import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileChangesDialog } from "./FileChangesDialog";

const changes = [
  {
    path: "C:/proj/a.ts",
    before: "old",
    after: "new",
    beforeKnown: true,
    removed: [] as string[],
    added: [] as string[],
  },
];

describe("FileChangesDialog", () => {
  it("closes via the X button", () => {
    const onClose = vi.fn();
    render(<FileChangesDialog changes={changes} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the X button on mousedown", () => {
    const onClose = vi.fn();
    render(<FileChangesDialog changes={changes} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<FileChangesDialog changes={changes} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via overlay backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <FileChangesDialog changes={changes} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector(".file-changes-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
