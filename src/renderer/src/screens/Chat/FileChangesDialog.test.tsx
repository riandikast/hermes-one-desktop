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

  it("says a baseline is missing when no diff evidence was captured", () => {
    render(
      <FileChangesDialog
        changes={[
          {
            path: "C:/proj/unknown.ts",
            before: null,
            after: "const current = true;",
            beforeKnown: false,
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    // The vague "diff unavailable" was replaced by the actual reason.
    expect(screen.getAllByText("Changed — no previous version").length).toBeGreaterThan(0);
  });

  it("explains the lost-snapshot race when before equals after", () => {
    render(
      <FileChangesDialog
        changes={[
          {
            path: "C:/proj/raced.ts",
            before: "same text",
            after: "same text",
            beforeKnown: true,
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Edited — full diff unavailable").length).toBeGreaterThan(0);
  });

  it("renders a hunk diff when the payload carried old/new strings", () => {
    render(
      <FileChangesDialog
        changes={[
          {
            path: "C:/proj/patched.ts",
            before: "old line",
            after: "new line",
            beforeKnown: false,
            removed: ["old line"],
            added: ["new line"],
          },
        ]}
        onClose={vi.fn()}
      />,
    );
    // Stats come from the hunk, so a real -N/+N is shown instead of a caveat.
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
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
