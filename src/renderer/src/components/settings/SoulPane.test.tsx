import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import SoulPane from "./SoulPane";

const api = {
  getConnectionConfig: vi.fn(),
  listProfiles: vi.fn(),
  getHermesHome: vi.fn(),
  readSoul: vi.fn(),
  writeSoul: vi.fn(),
};
const dirty = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(window, { hermesAPI: api });
  api.getConnectionConfig.mockResolvedValue({ mode: "local" });
  api.listProfiles.mockResolvedValue([{ id: "coder", isActive: true }]);
  api.getHermesHome.mockResolvedValue("C:/fixture/profiles/coder");
  api.readSoul.mockResolvedValue("# Original\r\n\r\ntext  \r\n");
  api.writeSoul.mockResolvedValue(true);
});

async function editor(): Promise<HTMLTextAreaElement> {
  const input = screen.getByRole("textbox");
  await waitFor(() => expect(input).not.toBeDisabled());
  return input as HTMLTextAreaElement;
}

describe("Settings Soul editor", () => {
  // @lat: [[lat.md/soul-settings#Soul settings#Exact markdown and profile]]
  it("resolves the active profile, saves exact markdown only explicitly, verifies readback", async () => {
    renderWithI18n(<SoulPane onDirtyChange={dirty} />);
    const input = await editor();
    expect(api.readSoul).toHaveBeenCalledWith("coder");
    expect(api.writeSoul).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "# Updated\n\ntext  \n" } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    api.readSoul
      .mockResolvedValueOnce("# Original\r\n\r\ntext  \r\n")
      .mockResolvedValueOnce("# Updated\r\n\r\ntext  \r\n");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.writeSoul).toHaveBeenCalledWith(
        "# Updated\r\n\r\ntext  \r\n",
        "coder",
      ),
    );
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });

  // @lat: [[lat.md/soul-settings#Soul settings#Failures retain drafts]]
  it("keeps edits dirty on failed save, detects disk conflicts, confirms reload", async () => {
    renderWithI18n(<SoulPane profile="explicit" onDirtyChange={dirty} />);
    const input = await editor();
    fireEvent.change(input, { target: { value: "unsaved" } });
    api.writeSoul.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("unsaved");
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(api.listProfiles).not.toHaveBeenCalled();
    api.writeSoul.mockClear();
    api.readSoul.mockResolvedValue("external edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("changed on disk"),
    );
    expect(api.writeSoul).not.toHaveBeenCalled();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(input).toHaveValue("unsaved");
  });

  // @lat: [[lat.md/soul-settings#Soul settings#Remote isolation]]
  it.each(["remote", "ssh"])(
    "blocks %s before reading local Soul",
    async (mode) => {
      api.getConnectionConfig.mockResolvedValue({ mode });
      renderWithI18n(<SoulPane onDirtyChange={dirty} />);
      await screen.findByRole("alert");
      expect(api.readSoul).not.toHaveBeenCalled();
      expect(api.writeSoul).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toBeDisabled();
    },
  );

  it("ignores stale profile loads", async () => {
    let resolve!: (text: string) => void;
    api.readSoul.mockReturnValueOnce(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    const view = renderWithI18n(
      <SoulPane profile="old" onDirtyChange={dirty} />,
    );
    await waitFor(() => expect(api.readSoul).toHaveBeenCalledWith("old"));
    view.rerender(<SoulPane profile="new" onDirtyChange={dirty} />);
    const input = await editor();
    await act(async () => resolve("stale"));
    expect(input.value).not.toBe("stale");
  });

  it("blocks a save if connection mode changed after loading", async () => {
    renderWithI18n(<SoulPane profile="default" onDirtyChange={dirty} />);
    fireEvent.change(await editor(), { target: { value: "draft" } });
    api.getConnectionConfig.mockResolvedValue({ mode: "remote" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(api.writeSoul).not.toHaveBeenCalled();
  });
});
