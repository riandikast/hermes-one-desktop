import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("react-hot-toast", () => ({ default: { success: toastSuccess } }));
import { KnowledgePackages } from "./KnowledgePackages";
import { emptyKnowledgeSettings } from "../../../../shared/knowledge-package";
vi.mock("../../components/modal/AppModal", () => ({
  AppModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  AppModalTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AppModalDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));
const imported = vi.fn(async () => {}),
  located = vi.fn(async () => {}),
  save = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, {
    hermesAPI: {
      previewKnowledgePackage: vi.fn(async () => ({
        ticket: "preview",
        bundles: [{ name: "guide", files: 2, conflict: true }],
        sources: [{ id: "source", name: "Project" }],
      })),
      importKnowledgePackage: vi.fn(async () => ({
        bundles: ["guide-imported"],
        settings: emptyKnowledgeSettings(),
      })),
      exportKnowledgePackage: vi.fn(async () => "knowledge.zip"),
      selectFolder: vi.fn(async () => "D:/Project"),
      listKnowledgeSources: vi.fn(async () => [
        { id: "source", name: "Project", root: null },
      ]),
      locateKnowledgeSource: vi.fn(async () => emptyKnowledgeSettings()),
    },
  });
});
const mount = (): ReturnType<typeof render> =>
  render(
    <KnowledgePackages
      settings={emptyKnowledgeSettings()}
      beforeExport={save}
      onImported={imported}
      onLocated={located}
    />,
  );
// @lat: [[knowledge-packages#Portable knowledge packages#Import preview controls]]
it("previews conflicts, maps external root, imports only after confirmation", async () => {
  mount();
  fireEvent.click(screen.getByText("Import Package"));
  const name = await screen.findByRole("textbox", {
    name: "Import name for guide",
  });
  expect((name as HTMLInputElement).value).toBe("guide-imported");
  expect(window.hermesAPI.importKnowledgePackage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Locate folder for Project"));
  await screen.findByText("D:/Project");
  fireEvent.click(screen.getByText("Import bundles"));
  await waitFor(() => expect(imported).toHaveBeenCalledOnce());
  expect(toastSuccess).toHaveBeenCalledWith("Imported 1 bundle(s).");
  expect(window.hermesAPI.importKnowledgePackage).toHaveBeenCalledWith({
    ticket: "preview",
    names: { guide: "guide-imported" },
    roots: { source: "D:/Project" },
  });
});
it("cancels without importing; saves before exporting", async () => {
  mount();
  fireEvent.click(screen.getByText("Import Package"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("Cancel"));
  expect(window.hermesAPI.importKnowledgePackage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Export Package"));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(window.hermesAPI.exportKnowledgePackage).toHaveBeenCalledOnce(),
  );
  expect(toastSuccess).toHaveBeenCalledWith("Package exported: knowledge.zip");
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(
    (window.hermesAPI.exportKnowledgePackage as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0],
  );
});
it("shows validation failures without claiming success", async () => {
  vi.mocked(window.hermesAPI.importKnowledgePackage).mockRejectedValue(
    new Error("Bundle exists"),
  );
  mount();
  fireEvent.click(screen.getByText("Import Package"));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByText("Import bundles"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Bundle exists");
  expect(imported).not.toHaveBeenCalled();
});
it("locates an unresolved source later, applies source settings and refreshes", async () => {
  mount();
  fireEvent.click(screen.getByText("Portable Sources"));
  await screen.findByText("Unresolved");
  fireEvent.click(screen.getByText("Locate folder for Project"));
  await waitFor(() =>
    expect(located).toHaveBeenCalledWith("source", "D:/Project"),
  );
  expect(imported).toHaveBeenCalledWith(emptyKnowledgeSettings());
});
