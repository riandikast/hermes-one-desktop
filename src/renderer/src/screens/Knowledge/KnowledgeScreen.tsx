import { useEffect, useState, useCallback } from "react";
import {
  BookOpen,
  Folder,
  FileText,
  Plus,
  Trash2,
  Copy,
  Check,
  Upload,
  Edit3,
  Eye,
  Save,
  ChevronRight,
  ChevronDown,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

export interface KnowledgeFileItem {
  name: string;
  relativePath: string;
  path: string;
  size: number;
}

export interface KnowledgeBundleItem {
  name: string;
  path: string;
  files: KnowledgeFileItem[];
}

export function KnowledgeScreen(): React.JSX.Element {
  const { t } = useI18n();
  const [bundles, setBundles] = useState<KnowledgeBundleItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<{
    bundleName: string;
    fileName: string;
    path: string;
  } | null>(null);

  const [fileContent, setFileContent] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newBundleName, setNewBundleName] = useState("");
  const [showNewBundleInput, setShowNewBundleInput] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [addingFileBundle, setAddingFileBundle] = useState<string | null>(null);

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({});

  const reloadBundles = useCallback(async () => {
    try {
      const list = await window.hermesAPI.listKnowledgeBundles();
      setBundles(list || []);
    } catch {
      setBundles([]);
    }
  }, []);

  useEffect(() => {
    void reloadBundles();
  }, [reloadBundles]);

  const toggleBundleExpand = (bundleName: string) => {
    setExpandedBundles((prev) => ({
      ...prev,
      [bundleName]: !prev[bundleName],
    }));
  };

  const handleSelectFile = async (bundleName: string, fileName: string, path: string) => {
    setLoading(true);
    setSelectedFile({ bundleName, fileName, path });
    try {
      const content = await window.hermesAPI.readKnowledgeFile(bundleName, fileName);
      setFileContent(content ?? "");
    } catch {
      setFileContent("");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await window.hermesAPI.writeKnowledgeFile(
        selectedFile.bundleName,
        selectedFile.fileName,
        fileContent,
      );
      await reloadBundles();
    } catch {
      /* ignore save error */
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBundle = async () => {
    const trimmed = newBundleName.trim();
    if (!trimmed) return;
    try {
      await window.hermesAPI.createKnowledgeBundle(trimmed);
      setNewBundleName("");
      setShowNewBundleInput(false);
      await reloadBundles();
      setExpandedBundles((prev) => ({ ...prev, [trimmed]: true }));
    } catch {
      /* ignore error */
    }
  };

  const handleDeleteBundle = async (bundleName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete knowledge bundle "${bundleName}" and all its files?`)) return;
    try {
      await window.hermesAPI.deleteKnowledgeBundle(bundleName);
      if (selectedFile?.bundleName === bundleName) {
        setSelectedFile(null);
        setFileContent("");
      }
      await reloadBundles();
    } catch {
      /* ignore error */
    }
  };

  const handleAddFile = async (bundleName: string) => {
    const trimmed = newFileName.trim();
    if (!trimmed) return;
    const finalName = trimmed.endsWith(".md") || trimmed.includes(".") ? trimmed : `${trimmed}.md`;
    try {
      await window.hermesAPI.writeKnowledgeFile(bundleName, finalName, `# ${finalName}\n\n`);
      setNewFileName("");
      setAddingFileBundle(null);
      await reloadBundles();
      const bundle = bundles.find((b) => b.name === bundleName);
      const filePath = bundle ? `${bundle.path}/${finalName}` : "";
      void handleSelectFile(bundleName, finalName, filePath);
    } catch {
      /* ignore error */
    }
  };

  const handleDeleteFile = async (bundleName: string, fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete file "${fileName}"?`)) return;
    try {
      await window.hermesAPI.deleteKnowledgeFile(bundleName, fileName);
      if (selectedFile?.bundleName === bundleName && selectedFile?.fileName === fileName) {
        setSelectedFile(null);
        setFileContent("");
      }
      await reloadBundles();
    } catch {
      /* ignore error */
    }
  };

  const handleImportFolder = async () => {
    try {
      const folderPath = await window.hermesAPI.selectFolder();
      if (!folderPath) return;
      const parts = folderPath.split(/[\\/]/).filter(Boolean);
      const folderName = parts.at(-1) || "imported-knowledge";
      await window.hermesAPI.importKnowledgeFolder(folderPath, folderName);
      await reloadBundles();
    } catch {
      /* ignore import error */
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(label);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  return (
    <div className="knowledge-screen">
      <div className="knowledge-header">
        <div className="knowledge-title">
          <BookOpen size={20} />
          <h2>Knowledge Management</h2>
        </div>
        <div className="knowledge-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowNewBundleInput((v) => !v)}
          >
            <Plus size={14} />
            <span>New Bundle</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleImportFolder}>
            <Upload size={14} />
            <span>Import Folder</span>
          </button>
        </div>
      </div>

      {showNewBundleInput && (
        <div className="knowledge-new-bundle-bar">
          <input
            type="text"
            placeholder="Bundle name (e.g. ui-guidelines)..."
            value={newBundleName}
            onChange={(e) => setNewBundleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreateBundle()}
          />
          <button type="button" className="btn btn-primary" onClick={handleCreateBundle}>
            Create
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowNewBundleInput(false)}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="knowledge-body">
        {/* Left Tree Pane */}
        <div className="knowledge-sidebar">
          <div className="knowledge-sidebar-title">Global Knowledge Bundles</div>
          {bundles.length === 0 ? (
            <div className="knowledge-empty-state">
              No knowledge bundles yet. Create one or import a folder to get started.
            </div>
          ) : (
            <div className="knowledge-bundle-list">
              {bundles.map((bundle) => {
                const isExpanded = expandedBundles[bundle.name] ?? true;
                return (
                  <div key={bundle.name} className="knowledge-bundle-item">
                    <div
                      className="knowledge-bundle-header"
                      onClick={() => toggleBundleExpand(bundle.name)}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Folder size={14} className="folder-icon" />
                      <span className="bundle-name">{bundle.name}</span>
                      <div className="bundle-hover-actions">
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          title="Add File"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddingFileBundle(
                              addingFileBundle === bundle.name ? null : bundle.name,
                            );
                          }}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs danger"
                          title="Delete Bundle"
                          onClick={(e) => void handleDeleteBundle(bundle.name, e)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {addingFileBundle === bundle.name && (
                      <div className="knowledge-add-file-bar" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          placeholder="File name (e.g. style.md)..."
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && void handleAddFile(bundle.name)
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-xs btn-primary"
                          onClick={() => void handleAddFile(bundle.name)}
                        >
                          Add
                        </button>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="knowledge-file-list">
                        {bundle.files.length === 0 ? (
                          <div className="knowledge-no-files">No files</div>
                        ) : (
                          bundle.files.map((file) => {
                            const isSelected =
                              selectedFile?.bundleName === bundle.name &&
                              selectedFile?.fileName === file.name;
                            const mentionTag = `@knowledge/${bundle.name}/${file.name}`;
                            return (
                              <div
                                key={file.name}
                                className={`knowledge-file-item ${isSelected ? "selected" : ""}`}
                                onClick={() =>
                                  void handleSelectFile(bundle.name, file.name, file.path)
                                }
                              >
                                <FileText size={13} />
                                <span className="file-name">{file.name}</span>
                                <div className="file-hover-actions">
                                  <button
                                    type="button"
                                    className="btn-ghost btn-xs"
                                    title="Copy Disk Path"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(file.path, `path:${file.path}`);
                                    }}
                                  >
                                    {copiedPath === `path:${file.path}` ? (
                                      <Check size={12} />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-xs"
                                    title="Copy @ Mention Tag"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(mentionTag, `tag:${mentionTag}`);
                                    }}
                                  >
                                    {copiedPath === `tag:${mentionTag}` ? (
                                      <Check size={12} />
                                    ) : (
                                      <span className="tag-icon">@</span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-xs danger"
                                    title="Delete File"
                                    onClick={(e) =>
                                      void handleDeleteFile(bundle.name, file.name, e)
                                    }
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Editor Pane */}
        <div className="knowledge-editor-pane">
          {selectedFile ? (
            <div className="knowledge-editor-container">
              <div className="knowledge-editor-toolbar">
                <div className="file-info">
                  <FileText size={16} />
                  <span className="file-title">
                    {selectedFile.bundleName} / {selectedFile.fileName}
                  </span>
                  <span className="file-path" title={selectedFile.path}>
                    {selectedFile.path}
                  </span>
                </div>
                <div className="toolbar-controls">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsEditing((v) => !v)}
                  >
                    {isEditing ? <Eye size={13} /> : <Edit3 size={13} />}
                    <span>{isEditing ? "Preview" : "Edit"}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleSaveFile()}
                    disabled={saving}
                  >
                    <Save size={13} />
                    <span>{saving ? "Saving..." : "Save"}</span>
                  </button>
                </div>
              </div>

              <div className="knowledge-editor-body">
                {loading ? (
                  <div className="editor-loading">Loading content...</div>
                ) : isEditing ? (
                  <textarea
                    className="knowledge-textarea"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    placeholder="Type knowledge notes, guidelines, or preferences..."
                  />
                ) : (
                  <div className="knowledge-markdown-preview">
                    <pre>{fileContent}</pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="knowledge-no-selection">
              <BookOpen size={36} />
              <p>Select a file from the knowledge bundles on the left to edit or view.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeScreen;
