import { BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import {
  exportKnowledgePackage,
  previewKnowledgePackage,
  importKnowledgePackage,
  getKnowledgeDocumentReferences,
  saveKnowledgeDocument,
  readKnowledgePortableState,
  locateKnowledgeSource,
  type DocumentReference,
} from "../knowledge-package";
import type {
  KnowledgeImportOptions,
  KnowledgeSourceSettings,
} from "../../shared/knowledge-package";

export function registerKnowledgePackageHandlers(): void {
  ipcMain.handle(
    "knowledge:export-package",
    async (event, settings: KnowledgeSourceSettings) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: "Export Knowledge Package",
        defaultPath: "knowledge.zip",
        filters: [{ name: "Knowledge ZIP", extensions: ["zip"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      const archive = await exportKnowledgePackage(settings);
      await writeFile(result.filePath, archive);
      if (!(await readFile(result.filePath)).equals(archive))
        throw new Error("Export verification failed");
      return result.filePath;
    },
  );
  ipcMain.handle("knowledge:preview-package", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import Knowledge Package",
      properties: ["openFile"],
      filters: [{ name: "Knowledge ZIP", extensions: ["zip"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    if ((await stat(result.filePaths[0])).size > 32 * 1024 * 1024)
      throw new Error("Package exceeds 32 MB");
    return previewKnowledgePackage(await readFile(result.filePaths[0]));
  });
  ipcMain.handle(
    "knowledge:import-package",
    (_event, options: KnowledgeImportOptions) =>
      importKnowledgePackage(options),
  );
  ipcMain.handle("knowledge:document-references", (_event, key: string) =>
    getKnowledgeDocumentReferences(key),
  );
  ipcMain.handle(
    "knowledge:save-document",
    (
      _event,
      key: string,
      content: string,
      refs: DocumentReference[],
      roots: string[],
    ) => saveKnowledgeDocument(key, content, refs, roots),
  );
  ipcMain.handle(
    "knowledge:portable-sources",
    async () => (await readKnowledgePortableState()).sources,
  );
  ipcMain.handle(
    "knowledge:locate-source",
    (_event, id: string, root: string) => locateKnowledgeSource(id, root),
  );
}
