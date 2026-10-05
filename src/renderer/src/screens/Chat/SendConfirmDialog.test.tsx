// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { projectLabel, SendConfirmDialog } from "./SendConfirmDialog";

/**
 * The send-confirmation dialog exists to catch a prompt being sent into the
 * WRONG session, so the two things that matter are: it names the target project
 * (including enough of the path to tell same-named folders apart), and the
 * Enter-twice contract keeps working.
 */

describe("projectLabel", () => {
  it("returns the last path segment for either separator", () => {
    expect(projectLabel("C:\\projects\\hermes-desktop")).toBe("hermes-desktop");
    expect(projectLabel("/home/me/work/api")).toBe("api");
  });

  it("handles trailing separators and a bare name", () => {
    expect(projectLabel("C:\\projects\\app\\")).toBe("app");
    expect(projectLabel("app")).toBe("app");
  });

  it("falls back to the raw value for an empty/odd path", () => {
    expect(projectLabel("")).toBe("");
    expect(projectLabel("C:\\")).toBe("C:");
  });
});

describe("SendConfirmDialog", () => {
  const noop = (): void => undefined;

  it("renders nothing while closed", () => {
    render(
      <SendConfirmDialog
        open={false}
        folders={["C:\\p\\app"]}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the project and shows its full path", () => {
    render(
      <SendConfirmDialog
        open
        folders={["C:\\work\\api-server"]}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText("api-server")).toBeTruthy();
    // The full path is what distinguishes two folders with the same name.
    expect(
      document.querySelector(".send-confirm-project-path")?.textContent,
    ).toBe("C:\\work\\api-server");
  });

  it("counts additional folders when several are active", () => {
    render(
      <SendConfirmDialog
        open
        folders={["C:\\a", "C:\\b", "C:\\c"]}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("says so when no project folder is bound", () => {
    render(
      <SendConfirmDialog open folders={[]} onConfirm={noop} onCancel={noop} />,
    );
    expect(screen.getByText(/no project folder bound/i)).toBeTruthy();
  });

  it("confirms on Enter (the second Enter of the double-Enter contract)", () => {
    const onConfirm = vi.fn();
    render(
      <SendConfirmDialog
        open
        folders={["C:\\x"]}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(
      <SendConfirmDialog
        open
        folders={["C:\\x"]}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT confirm on Shift+Enter (that is a newline in the composer)", () => {
    const onConfirm = vi.fn();
    render(
      <SendConfirmDialog
        open
        folders={["C:\\x"]}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    act(() => {
      fireEvent.keyDown(document, { key: "Enter", shiftKey: true });
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms/cancels via the buttons too", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SendConfirmDialog
        open
        folders={["C:\\x"]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    act(() => {
      screen.getByRole("button", { name: /^send$/i }).click();
    });
    act(() => {
      screen.getByRole("button", { name: /cancel/i }).click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels when the backdrop is clicked, but not the panel", () => {
    const onCancel = vi.fn();
    render(
      <SendConfirmDialog
        open
        folders={["C:\\x"]}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    const panel = document.querySelector(".send-confirm-dialog") as HTMLElement;
    act(() => {
      panel.click();
    });
    expect(onCancel).not.toHaveBeenCalled();

    const overlay = document.querySelector(
      ".send-confirm-overlay",
    ) as HTMLElement;
    act(() => {
      overlay.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stops listening for keys once closed", () => {
    const onConfirm = vi.fn();
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            close
          </button>
          <SendConfirmDialog
            open={open}
            folders={["C:\\x"]}
            onConfirm={onConfirm}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Harness />);
    act(() => {
      screen.getByRole("button", { name: "close" }).click();
    });
    expect(document.querySelector(".send-confirm-dialog")).toBeNull();
    // The document listener must be gone: Enter now does nothing here.
    act(() => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
