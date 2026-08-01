import { useEffect, useState, useCallback, useRef } from "react";
import { findMention } from "../Chat/mention";
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

  // @ mention autocomplete state
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionCustomFolders, setMentionCustomFolders] = useState<string[]>([]);
  const [mentionResults, setMentionResults] = useState<
    Array<{ name: string; path: string; isDirectory: boolean }>
  >([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const handlePickMentionFolder = async () => {
    try {
      const folderPath = await window.hermesAPI.selectFolder();
      if (!folderPath) return;
      setMentionCustomFolders((prev) =>
        prev.includes(folderPath) ? prev : [...prev, folderPath],
      );
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    const q = mentionQuery.trim().toLowerCase();

    void (async () => {
      try {
        let matches: Array<{ name: string; path: string; isDirectory: boolean }> = [];

        // 1. Add files from all knowledge bundles
        for (const bundle of bundles) {
          for (const file of bundle.files) {
            if (!q || file.name.toLowerCase().includes(q) || file.path.toLowerCase().includes(q)) {
              matches.push({
                name: file.name,
                path: file.path,
                isDirectory: false,
              });
            }
          }
        }

        // 2. Add files from custom picked folders
        for (const folder of mentionCustomFolders) {
          try {
            const entries = await window.hermesAPI.readDirectory(folder);
            if (entries && Array.isArray(entries)) {
              for (const en of entries) {
                if (!q || en.name.toLowerCase().includes(q)) {
                  matches.push({
                    name: en.name,
                    path: `${folder}/${en.name}`,
                    isDirectory: en.isDirectory,
                  });
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        // 3. Add Everything Search results
        if (window.hermesAPI.everythingSearch) {
          try {
            const ev = await window.hermesAPI.everythingSearch(q || "a");
            if (ev && Array.isArray(ev)) {
              const seen = new Set(matches.map((m) => m.path));
              for (const item of ev) {
                if (!seen.has(item.path)) {
                  matches.push({
                    name: item.name,
                    path: item.path,
                    isDirectory: item.isDirectory,
                  });
                  seen.add(item.path);
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        if (matches.length === 0) {
          try {
            const recent = await window.hermesAPI.listRecentSessionContextFolders(10);
            if (recent && Array.isArray(recent)) {
              const seen = new Set(matches.map((m) => m.path));
              for (const p of recent) {
                if (!seen.has(p)) {
                  const parts = p.split(/[\\/]/).filter(Boolean);
                  matches.push({
                    name: parts.at(-1) || p,
                    path: p,
                    isDirectory: true,
                  });
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        if (!cancelled) {
          setMentionResults(matches.slice(0, 20));
        }
      } catch {
        if (!cancelled) setMentionResults([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, bundles, mentionCustomFolders]);

  const handleTextareaCaret = (
    e: React.SyntheticEvent<HTMLTextAreaElement>,
  ) => {
    const target = e.currentTarget;
    const caret = target.selectionStart;
    const m = findMention(target.value, caret);
    if (m) {
      setMentionOpen(true);
      setMentionStart(m.start);
      setMentionQuery(m.query);
      setMentionSelectedIndex(0);
    } else {
      setMentionOpen(false);
    }
  };

  const insertFileMention = (entry: { name: string; path: string }) => {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? fileContent.length;
    const before = fileContent.slice(0, mentionStart);
    const after = fileContent.slice(caret);
    const inserted = entry.path;
    const next = before + inserted + " " + after;
    setFileContent(next);
    setMentionOpen(false);

    setTimeout(() => {
      if (textarea) {
        const newPos = mentionStart + inserted.length + 1;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
        textarea.focus();
      }
    }, 0);
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (!mentionOpen || mentionResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionSelectedIndex((i) => (i + 1) % mentionResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionSelectedIndex(
        (i) => (i - 1 + mentionResults.length) % mentionResults.length,
      );
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const selected = mentionResults[mentionSelectedIndex];
      if (selected) {
        insertFileMention(selected);
      }
    } else if (e.key === "Escape") {
      setMentionOpen(false);
    }
  };

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
          {bundles.length === 0 ? null : (
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
                    onClick={() => void handlePickMentionFolder()}
                    title="Pick folder to index files for @ mention"
                  >
                    <Folder size={13} />
                    <span>
                      {mentionCustomFolders.length > 0
                        ? `@ Folders (${mentionCustomFolders.length})`
                        : "@ Pick Folder"}
                    </span>
                  </button>
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

              <div className="knowledge-editor-body" style={{ position: "relative" }}>
                {loading ? (
                  <div className="editor-loading">Loading content...</div>
                ) : isEditing ? (
                  <>
                    <textarea
                      ref={textareaRef}
                      className="knowledge-textarea"
                      value={fileContent}
                      onChange={(e) => {
                        setFileContent(e.target.value);
                        handleTextareaCaret(e);
                      }}
                      onKeyUp={handleTextareaCaret}
                      onClick={handleTextareaCaret}
                      onKeyDown={handleTextareaKeyDown}
                      placeholder="Type knowledge notes, guidelines, or preferences (use @ to search file paths)..."
                    />
                    {mentionOpen && mentionResults.length > 0 && (
                      <div className="knowledge-mention-dropdown">
                        {mentionResults.map((item, idx) => (
                          <div
                            key={item.path}
                            className={`knowledge-mention-item ${
                              idx === mentionSelectedIndex ? "active" : ""
                            }`}
                            onClick={() => insertFileMention(item)}
                            onMouseEnter={() => setMentionSelectedIndex(idx)}
                          >
                            {item.isDirectory ? (
                              <Folder size={13} />
                            ) : (
                              <FileText size={13} />
                            )}
                            <span className="knowledge-mention-item-name">
                              {item.name}
                            </span>
                            <span
                              className="knowledge-mention-item-path"
                              title={item.path}
                            >
                              {item.path}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
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
