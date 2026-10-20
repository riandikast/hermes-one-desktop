import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextFolderChip } from "./ContextFolderChip";
import { setProjectAlias } from "../Layout/projectAliases";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

it("counts every selected folder and makes a right-clicked folder the terminal base", async () => {
  const first = "C:/work/first";
  const second = "C:/work/second";
  window.hermesAPI = {
    listRecentSessionContextFolders: vi.fn().mockResolvedValue([]),
  } as unknown as typeof window.hermesAPI;
  const setBase = vi.fn();
  render(
    <ContextFolderChip
      contextFolders={[first, second]}
      show
      onPickFolder={vi.fn()}
      onRemoveFolder={vi.fn()}
      onSetBaseFolder={setBase}
    />,
  );

  expect(screen.getByText("Folder (2)")).toBeTruthy();
  fireEvent.click(screen.getByTitle("chat.setContextFolder"));
  const secondRow = screen.getByTitle(
    `${second} — click to remove; right-click to use as terminal base folder`,
  );
  fireEvent.contextMenu(secondRow);
  expect(setBase).toHaveBeenCalledWith(second);
});

it("uses live sidebar aliases in selected and recent folders, preserving callback paths", async () => {
  const selected = "C:/work/actual-folder";
  const recent = "C:/work/another-folder";
  localStorage.clear();
  setProjectAlias(selected, "Renamed project");
  setProjectAlias(recent, "Recent alias");
  window.hermesAPI = {
    listRecentSessionContextFolders: vi.fn().mockResolvedValue([recent]),
  } as unknown as typeof window.hermesAPI;
  const remove = vi.fn();
  const select = vi.fn();
  render(<ContextFolderChip contextFolders={[selected]} show onPickFolder={vi.fn()}
    onRemoveFolder={remove} onSelectRecentFolder={select} />);
  fireEvent.click(screen.getByTitle("chat.setContextFolder"));
  expect(await screen.findByText("Recent alias")).toBeTruthy();
  expect(screen.getByText("Renamed project")).toBeTruthy();
  act(() => setProjectAlias(selected, "Edited while open"));
  fireEvent.click(screen.getByText("Edited while open"));
  expect(remove).toHaveBeenCalledWith(selected);
  fireEvent.click(screen.getByText("Recent alias"));
  expect(select).toHaveBeenCalledWith(recent);
  act(() => setProjectAlias(selected, ""));
  fireEvent.click(screen.getByTitle("chat.setContextFolder"));
  expect(screen.getByText("actual-folder")).toBeTruthy();
});
