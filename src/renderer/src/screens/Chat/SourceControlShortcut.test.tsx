import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { SourceControlShortcut } from "./SourceControlShortcut";

vi.mock("./SourceControlDialog", () => ({
  SourceControlDialog: ({ dir, onClose }: { dir: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Source Control dialog">
      <span>{dir}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const shortcut = (baseFolder: string | undefined, available = true): React.JSX.Element => (
  <I18nProvider><SourceControlShortcut baseFolder={baseFolder} available={available} /></I18nProvider>
);

describe("SourceControlShortcut", () => {
  it("opens the base folder, follows selection changes, and closes", async () => {
    const view = render(shortcut("C:/first"));
    const button = screen.getByRole("button", { name: "Source Control" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toHaveTextContent("C:/first");
    expect(button).toHaveAttribute("aria-expanded", "true");
    view.rerender(shortcut("C:/second"));
    expect(screen.getByRole("dialog")).toHaveTextContent("C:/second");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when its base folder is removed", () => {
    const view = render(shortcut("C:/first"));
    fireEvent.click(screen.getByRole("button", { name: "Source Control" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("C:/first");
    view.rerender(shortcut(undefined));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(shortcut("C:/second"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Source Control" })).toBeEnabled();
  });

  it("disables without a base folder or local connection", () => {
    const view = render(shortcut(undefined));
    expect(screen.getByRole("button", { name: "Source Control" })).toBeDisabled();
    view.rerender(shortcut("C:/first", false));
    expect(screen.getByRole("button", { name: "Source Control" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(shortcut("C:/first"));
    fireEvent.click(screen.getByRole("button", { name: "Source Control" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("C:/first");
    view.rerender(shortcut("C:/first", false));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(shortcut("C:/first"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
