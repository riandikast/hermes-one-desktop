import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import SettingsModal from "./SettingsModal";

vi.mock("./useSettingsData", () => ({ useSettingsData: () => ({}) }));
vi.mock("./SoulPane", () => ({ default: ({ onDirtyChange }: { onDirtyChange: (value: boolean) => void }) => <button onClick={() => onDirtyChange(true)}>Edit soul draft</button> }));
vi.mock("./GitHubPane", () => ({ default: () => <div>GitHub pane</div> }));
vi.mock("../modal/AppModal", () => ({
  AppModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppModalTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

it("opens /settings soul and confirms before navigation or closing a dirty draft", () => {
  const close = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderWithI18n(<SettingsModal open initialSection="soul" profile="coder" onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit soul draft" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
  expect(screen.getByRole("button", { name: "Edit soul draft" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
  expect(screen.getByText("GitHub pane")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
});
