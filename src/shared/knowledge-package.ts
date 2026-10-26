export interface KnowledgeReference {
  start: number;
  end: number;
  text: string;
  target:
    | { kind: "bundle"; path: string }
    | { kind: "source"; source: string; path: string };
}
export interface KnowledgeSource {
  id: string;
  name: string;
  root: string | null;
}
export interface KnowledgeSourceSettings {
  folders: string[];
  fileFolders: Record<string, string[]>;
  folderState: Record<string, Record<string, boolean>>;
  disabledBundles: Record<string, boolean>;
}
export interface KnowledgePortableState {
  sources: KnowledgeSource[];
  references: Record<string, KnowledgeReference[]>;
  settings?: KnowledgeSourceSettings;
}
export interface KnowledgePackagePreview {
  ticket: string;
  bundles: { name: string; files: number; conflict: boolean }[];
  sources: { id: string; name: string }[];
}
export interface KnowledgeImportOptions {
  ticket: string;
  names: Record<string, string>;
  roots: Record<string, string | null>;
}
export interface KnowledgeImportResult {
  bundles: string[];
  settings: KnowledgeSourceSettings;
}
export const emptyKnowledgeSettings = (): KnowledgeSourceSettings => ({
  folders: [],
  fileFolders: {},
  folderState: {},
  disabledBundles: {},
});
