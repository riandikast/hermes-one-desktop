import { useEffect, useState, useCallback, useRef } from "react";
import { findMention } from "../Chat/mention";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  BookOpen,
  Folder,
  FileText,
  Plus,
  Trash2,
  Copy,
  Check,
  Upload,
  Save,
  ChevronRight,
  ChevronDown,
  Pencil,
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

/** Escape a literal string for use inside a RegExp constructor. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function KnowledgeScreen(): React.JSX.Element {
  const [bundles, setBundles] = useState<KnowledgeBundleItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<{
    bundleName: string;
    fileName: string;
    path: string;
  } | null>(null);

  const [fileContent, setFileContent] = useState("");
  const [isEditing] = useState(true); // Always edit mode — preview removed
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newBundleName, setNewBundleName] = useState("");
  const [showNewBundleInput, setShowNewBundleInput] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [addingFileBundle, setAddingFileBundle] = useState<string | null>(null);
  const newBundleInputRef = useRef<HTMLInputElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingFile, setRenamingFile] = useState<{
    bundleName: string;
    oldFileName: string;
  } | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [renamingBundle, setRenamingBundle] = useState<string | null>(null);
  const [renamingBundleValue, setRenamingBundleValue] = useState("");

  // Drag & drop: which bundle the pointer is hovering over while a knowledge
  // file is dragged (visual drop-target highlight), plus the dragged file.
  const [dragOverBundle, setDragOverBundle] = useState<string | null>(null);
  const [draggedFile, setDraggedFile] = useState<{
    bundleName: string;
    fileName: string;
  } | null>(null);

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<
    Record<string, boolean>
  >({});

  // Focus + select the transient name inputs as soon as their bars appear, so
  // typing works immediately after clicking "New Bundle" / the add-file "+"
  // button (autoFocus alone misses cases where the input mounts while the
  // click is still in flight and the clicked button keeps focus).
  useEffect(() => {
    if (!showNewBundleInput) return;
    newBundleInputRef.current?.focus();
    newBundleInputRef.current?.select();
  }, [showNewBundleInput]);

  useEffect(() => {
    if (!addingFileBundle) return;
    addFileInputRef.current?.focus();
    addFileInputRef.current?.select();
  }, [addingFileBundle]);

  // Draggable bundle-list sidebar width (persisted) so the editor can get more
  // room. 320px default; clamps so the editor never starves.
  const [knowledgeSidebarWidth, setKnowledgeSidebarWidth] = useState<number>(
    () => {
      try {
        const raw = localStorage.getItem("hermes.knowledge.sidebarWidth");
        const parsed = raw ? Number(raw) : 320;
        return Number.isFinite(parsed)
          ? Math.min(560, Math.max(180, parsed))
          : 320;
      } catch {
        return 320;
      }
    },
  );
  const [knowledgeSidebarResizing, setKnowledgeSidebarResizing] =
    useState(false);
  const [knowledgeSidebarCollapsed, setKnowledgeSidebarCollapsed] = useState(
    () => {
      try {
        return (
          localStorage.getItem("hermes.knowledge.sidebarCollapsed") === "true"
        );
      } catch {
        return false;
      }
    },
  );
  const knowledgeResizeRef = useRef<{ startX: number; startWidth: number }>({
    startX: 0,
    startWidth: 320,
  });

  const toggleKnowledgeSidebar = (): void => {
    setKnowledgeSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("hermes.knowledge.sidebarCollapsed", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const onKnowledgeResizeStart = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    knowledgeResizeRef.current = {
      startX: e.clientX,
      startWidth: knowledgeSidebarWidth,
    };
    setKnowledgeSidebarResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onKnowledgeResizeMove = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (!knowledgeSidebarResizing) return;
    const { startX, startWidth } = knowledgeResizeRef.current;
    const next = Math.min(
      560,
      Math.max(180, startWidth + (e.clientX - startX)),
    );
    setKnowledgeSidebarWidth(next);
    try {
      localStorage.setItem("hermes.knowledge.sidebarWidth", String(next));
    } catch {
      /* ignore */
    }
  };

  const onKnowledgeResizeEnd = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    setKnowledgeSidebarResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // @ mention autocomplete state (CodeMirror-driven)
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [mentionCustomFolders, setMentionCustomFolders] = useState<string[]>(
    () => {
      try {
        const raw = localStorage.getItem("hermes.knowledge.custom_folders");
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        "hermes.knowledge.custom_folders",
        JSON.stringify(mentionCustomFolders),
      );
    } catch {
      /* ignore */
    }
  }, [mentionCustomFolders]);

  const [fileCustomFolders, setFileCustomFolders] = useState<
    Record<string, string[]>
  >(() => {
    try {
      const raw = localStorage.getItem("hermes.knowledge.file_custom_folders");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "hermes.knowledge.file_custom_folders",
        JSON.stringify(fileCustomFolders),
      );
    } catch {
      /* ignore */
    }
  }, [fileCustomFolders]);

  const [fileCustomFolderState, setFileCustomFolderState] = useState<
    Record<string, Record<string, boolean>>
  >(() => {
    try {
      const raw = localStorage.getItem(
        "hermes.knowledge.file_custom_folder_state",
      );
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "hermes.knowledge.file_custom_folder_state",
        JSON.stringify(fileCustomFolderState),
      );
    } catch {
      /* ignore */
    }
  }, [fileCustomFolderState]);
  const [disabledBundles, setDisabledBundles] = useState<
    Record<string, boolean>
  >({});
  const [showMentionSourcesPopover, setShowMentionSourcesPopover] =
    useState(false);

  const activeFileKey = selectedFile
    ? `${selectedFile.bundleName}/${selectedFile.fileName}`
    : "";

  const handleToggleCustomFolderForFile = (folderPath: string) => {
    const fileKey = selectedFile
      ? `${selectedFile.bundleName}/${selectedFile.fileName}`
      : "__global__";
    setFileCustomFolderState((prev) => {
      const fileMap = prev[fileKey] ?? {};
      const current = fileMap[folderPath] ?? true;
      return {
        ...prev,
        [fileKey]: {
          ...fileMap,
          [folderPath]: !current,
        },
      };
    });
  };

  const handlePickMentionFolder = async () => {
    try {
      const folderPath = await window.hermesAPI.selectFolder();
      if (!folderPath) return;
      setMentionCustomFolders((prev) =>
        prev.includes(folderPath) ? prev : [...prev, folderPath],
      );
      if (selectedFile) {
        const fileKey = `${selectedFile.bundleName}/${selectedFile.fileName}`;
        setFileCustomFolders((prev) => {
          const list = prev[fileKey] ?? [];
          return list.includes(folderPath)
            ? prev
            : { ...prev, [fileKey]: [...list, folderPath] };
        });
      }
    } catch {
      /* ignore */
    }
  };

  const handleRemoveMentionFolder = (folderPath: string) => {
    setMentionCustomFolders((prev) => prev.filter((f) => f !== folderPath));
    if (selectedFile) {
      const fileKey = `${selectedFile.bundleName}/${selectedFile.fileName}`;
      setFileCustomFolders((prev) => {
        const list = prev[fileKey] ?? [];
        return { ...prev, [fileKey]: list.filter((p) => p !== folderPath) };
      });
    }
  };

  const handleToggleMentionBundle = (bundleName: string) => {
    setDisabledBundles((prev) => ({
      ...prev,
      [bundleName]: !prev[bundleName],
    }));
  };

  // Search bundles + custom folders + Everything for @ mention candidates.
  const searchMentionMatches = useCallback(
    async (
      query: string,
    ): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> => {
      const q = query.trim().toLowerCase();
      let matches: Array<{ name: string; path: string; isDirectory: boolean }> =
        [];

      // 1. Add files from enabled knowledge bundles
      for (const bundle of bundles) {
        if (disabledBundles[bundle.name]) continue;
        for (const file of bundle.files) {
          if (
            !q ||
            file.name.toLowerCase().includes(q) ||
            file.path.toLowerCase().includes(q)
          ) {
            matches.push({
              name: file.name,
              path: file.path,
              isDirectory: false,
            });
          }
        }
      }

      // 2. Add files from custom picked folders (global + per-file, filtered
      // by per-file checkbox state — unchecked folders are hidden from @ mention).
      const activeFileFolders = activeFileKey
        ? (fileCustomFolders[activeFileKey] ?? [])
        : [];
      const searchFolders = [
        ...new Set([...mentionCustomFolders, ...activeFileFolders]),
      ].filter((folder) => {
        if (!activeFileKey) return true; // global when no file selected
        const fileState = fileCustomFolderState[activeFileKey] ?? {};
        return fileState[folder] !== false; // unchecked → hidden
      });
      for (const folder of searchFolders) {
        try {
          const entries = await window.hermesAPI.listFilesRecursive(folder);
          if (entries && Array.isArray(entries)) {
            for (const en of entries) {
              if (
                !q ||
                en.name.toLowerCase().includes(q) ||
                en.path.toLowerCase().includes(q)
              ) {
                matches.push({
                  name: en.name,
                  path: en.path,
                  isDirectory: en.isDirectory,
                });
              }
            }
          }
        } catch {
          /* ignore */
        }
      }

      // 3. Query Voidtools Everything (mirror ChatInput behavior)
      if (window.hermesAPI.everythingSearch && q.length >= 2) {
        try {
          const ev = await window.hermesAPI.everythingSearch(q);
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
          /* Everything search unavailable or failed */
        }
      }

      if (matches.length === 0) {
        try {
          const recent =
            await window.hermesAPI.listRecentSessionContextFolders(10);
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

      return matches.slice(0, 20);
    },
    [
      bundles,
      disabledBundles,
      activeFileKey,
      fileCustomFolders,
      mentionCustomFolders,
      fileCustomFolderState,
    ],
  );

  // CodeMirror autocomplete source for "@" file mentions. The EditorView is
  // created once, so this source must go through a ref — otherwise the view
  // would keep calling the FIRST closure (empty bundles/state from mount).
  const mentionSourceRef = useRef<
    (ctx: CompletionContext) => Promise<CompletionResult | null>
  >(async () => null);

  useEffect(() => {
    mentionSourceRef.current = async (
      ctx: CompletionContext,
    ): Promise<CompletionResult | null> => {
      const text = ctx.state.doc.toString();
      const m = findMention(text, ctx.pos);
      if (!m) return null;
      const matches = await searchMentionMatches(m.query);
      if (matches.length === 0) return null;
      const options = matches.map((item) => ({
        label: item.name,
        detail: item.path,
        type: item.isDirectory ? "folder" : "file",
        apply: (
          view: EditorView,
          _completion: unknown,
          from: number,
          to: number,
        ) => {
          view.dispatch({
            changes: { from, to, insert: item.path + " " },
            selection: { anchor: from + item.path.length + 1 },
          });
        },
      }));
      // filter: false — CM6 otherwise fuzzy-matches option labels against the
      // matched range text ("@" + query), and file-name labels never match an
      // "@" prefix, silently dropping every option. The source re-runs on each
      // keystroke (typing activation), so narrowing still works.
      return { from: m.start, to: ctx.pos, options, filter: false };
    };
  }, [searchMentionMatches]);

  // Keep the current file's content mirrored into `fileContent` state (the
  // save path reads it) and sync doc replacements when a new file is opened.
  const onEditorChange = useCallback((content: string) => {
    setFileContent(content);
  }, []);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: fileContent,
        extensions: [
          basicSetup,
          oneDark,
          search({ top: true }),
          markdown({ codeLanguages: languages }),
          autocompletion({
            override: [
              (ctx: CompletionContext) => mentionSourceRef.current(ctx),
            ],
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onEditorChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // Recreate when the host appears (loading → editing) or the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile?.path, loading]);

  // External content changes (file switch, save-as, focus refresh) replace
  // the editor doc without moving the caret to the start.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === fileContent) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: fileContent },
    });
  }, [fileContent]);

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

  // Auto-refresh when the Knowledge screen gains focus (e.g. clicking the
  // sidebar Knowledge nav) so newly imported files appear without a manual
  // reload — including re-reading the currently open file's content.
  useEffect(() => {
    const onFocus = () => {
      void reloadBundles();
      // Re-read the currently selected file's content from disk.
      if (selectedFile) {
        void (async () => {
          try {
            const content = await window.hermesAPI.readKnowledgeFile(
              selectedFile.bundleName,
              selectedFile.fileName,
            );
            setFileContent(content ?? "");
          } catch {
            /* ignore */
          }
        })();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadBundles, selectedFile]);

  const toggleBundleExpand = (bundleName: string) => {
    setExpandedBundles((prev) => ({
      ...prev,
      [bundleName]: !prev[bundleName],
    }));
  };

  const handleSelectFile = async (
    bundleName: string,
    fileName: string,
    path: string,
  ) => {
    setLoading(true);
    setSelectedFile({ bundleName, fileName, path });
    try {
      const content = await window.hermesAPI.readKnowledgeFile(
        bundleName,
        fileName,
      );
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

  const handleDeleteBundle = async (
    bundleName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!confirm(`Delete knowledge bundle "${bundleName}" and all its files?`))
      return;
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
    const finalName =
      trimmed.endsWith(".md") || trimmed.includes(".")
        ? trimmed
        : `${trimmed}.md`;
    try {
      await window.hermesAPI.writeKnowledgeFile(
        bundleName,
        finalName,
        `# ${finalName}\n\n`,
      );
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

  const startRenameFile = (
    bundleName: string,
    oldFileName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setRenamingFile({ bundleName, oldFileName });
    setRenamingValue(oldFileName);
  };

  const submitRenameFile = async () => {
    if (!renamingFile) return;
    const { bundleName, oldFileName } = renamingFile;
    let trimmed = renamingValue.trim();
    if (!trimmed) {
      setRenamingFile(null);
      return;
    }
    if (!trimmed.includes(".")) {
      const ext = oldFileName.includes(".")
        ? oldFileName.slice(oldFileName.lastIndexOf("."))
        : ".md";
      trimmed = `${trimmed}${ext}`;
    }
    if (trimmed === oldFileName) {
      setRenamingFile(null);
      return;
    }
    try {
      const ok = await window.hermesAPI.renameKnowledgeFile(
        bundleName,
        oldFileName,
        trimmed,
      );
      if (ok) {
        if (
          selectedFile?.bundleName === bundleName &&
          selectedFile?.fileName === oldFileName
        ) {
          const newPath = selectedFile.path.replace(oldFileName, trimmed);
          setSelectedFile({ bundleName, fileName: trimmed, path: newPath });
        }
        await reloadBundles();
      }
    } catch {
      /* ignore error */
    } finally {
      setRenamingFile(null);
    }
  };

  const startRenameBundle = (bundleName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingBundle(bundleName);
    setRenamingBundleValue(bundleName);
  };

  const submitRenameBundle = async () => {
    if (!renamingBundle) return;
    const oldName = renamingBundle;
    const trimmed = renamingBundleValue.trim();
    if (!trimmed) {
      setRenamingBundle(null);
      return;
    }
    if (trimmed === oldName) {
      setRenamingBundle(null);
      return;
    }
    try {
      const ok = await window.hermesAPI.renameKnowledgeBundle(oldName, trimmed);
      if (ok) {
        // Re-key per-bundle UI state (expansion, @ mention enablement) so the
        // renamed bundle keeps its previous settings.
        setExpandedBundles((prev) => {
          const next = { ...prev };
          if (prev[oldName] !== undefined) next[trimmed] = prev[oldName];
          return next;
        });
        setDisabledBundles((prev) => {
          const next = { ...prev };
          if (prev[oldName] !== undefined) next[trimmed] = prev[oldName];
          return next;
        });
        if (selectedFile?.bundleName === oldName) {
          const re = new RegExp(`[\\\\/]${escapeRegExp(oldName)}(?=[\\\\/]|$)`);
          setSelectedFile({
            bundleName: trimmed,
            fileName: selectedFile.fileName,
            path: selectedFile.path.replace(re, (m) =>
              m.replace(oldName, trimmed),
            ),
          });
        }
        await reloadBundles();
      }
    } catch {
      /* ignore error */
    } finally {
      setRenamingBundle(null);
    }
  };

  const handleDragFileStart = (
    e: React.DragEvent<HTMLDivElement>,
    bundleName: string,
    fileName: string,
  ) => {
    setDraggedFile({ bundleName, fileName });
    e.dataTransfer.setData("application/x-knowledge-file", fileName);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEndFile = () => {
    setDraggedFile(null);
    setDragOverBundle(null);
  };

  const handleDragOverBundle = (
    e: React.DragEvent<HTMLDivElement>,
    bundleName: string,
  ) => {
    if (!draggedFile) return;
    if (draggedFile.bundleName === bundleName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverBundle(bundleName);
  };

  const handleDropOnBundle = async (
    e: React.DragEvent<HTMLDivElement>,
    bundleName: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverBundle(null);
    const file = draggedFile;
    if (!file || file.bundleName === bundleName) return;
    try {
      const ok = await window.hermesAPI.moveKnowledgeFile(
        file.bundleName,
        file.fileName,
        bundleName,
      );
      if (ok) {
        if (
          selectedFile?.bundleName === file.bundleName &&
          selectedFile?.fileName === file.fileName
        ) {
          const target = bundles.find((b) => b.name === bundleName);
          if (target) {
            const sep = target.path.includes("\\") ? "\\" : "/";
            setSelectedFile({
              bundleName,
              fileName: file.fileName,
              path: `${target.path}${sep}${file.fileName}`,
            });
          }
        }
        await reloadBundles();
      }
    } catch {
      /* ignore error */
    } finally {
      setDraggedFile(null);
    }
  };

  const handleDeleteFile = async (
    bundleName: string,
    fileName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!confirm(`Delete file "${fileName}"?`)) return;
    try {
      await window.hermesAPI.deleteKnowledgeFile(bundleName, fileName);
      if (
        selectedFile?.bundleName === bundleName &&
        selectedFile?.fileName === fileName
      ) {
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleImportFolder}
          >
            <Upload size={14} />
            <span>Import Folder</span>
          </button>
        </div>
      </div>

      {showNewBundleInput && (
        <div className="knowledge-new-bundle-bar">
          <input
            ref={newBundleInputRef}
            type="text"
            autoFocus
            placeholder="Bundle name (e.g. ui-guidelines)..."
            value={newBundleName}
            onChange={(e) => setNewBundleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreateBundle()}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreateBundle}
          >
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

      <div
        className={
          bundles.length === 0
            ? "knowledge-body knowledge-body--empty"
            : "knowledge-body"
        }
      >
        {/* Left Tree Pane */}
        <div
          className={`knowledge-sidebar ${
            knowledgeSidebarResizing ? "knowledge-sidebar--resizing" : ""
          } ${knowledgeSidebarCollapsed ? "knowledge-sidebar--collapsed" : ""}`}
          style={
            knowledgeSidebarCollapsed
              ? { width: 44 }
              : { width: knowledgeSidebarWidth }
          }
        >
          <div
            className="knowledge-sidebar-resize"
            onPointerDown={onKnowledgeResizeStart}
            onPointerMove={onKnowledgeResizeMove}
            onPointerUp={onKnowledgeResizeEnd}
            aria-label="Resize bundle list"
            title="Drag to resize"
          />
          {knowledgeSidebarCollapsed ? (
            <button
              type="button"
              className="knowledge-sidebar-toggle collapsed"
              onClick={toggleKnowledgeSidebar}
              aria-label="Expand bundle list"
              title="Expand bundle list"
            >
              <ChevronRight size={14} />
            </button>
          ) : (
            <div className="knowledge-sidebar-title-row">
              <span className="knowledge-sidebar-title">
                Global Knowledge Bundles
              </span>
              <button
                type="button"
                className="knowledge-sidebar-toggle"
                onClick={toggleKnowledgeSidebar}
                aria-label="Collapse bundle list"
                title="Collapse bundle list"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          {!knowledgeSidebarCollapsed && (
            <div className="knowledge-bundle-list">
              {bundles.map((bundle) => {
                // Default COLLAPSED on page open (requested): the state only
                // records what the user explicitly toggled.
                const isExpanded = expandedBundles[bundle.name] ?? false;
                const isRenamingBundle = renamingBundle === bundle.name;
                return (
                  <div
                    key={bundle.name}
                    className={`knowledge-bundle-item ${
                      dragOverBundle === bundle.name
                        ? "knowledge-bundle-item--drag-over"
                        : ""
                    }`}
                    onDragOver={(e) => handleDragOverBundle(e, bundle.name)}
                    onDragLeave={(e) => {
                      if (
                        dragOverBundle === bundle.name &&
                        !(
                          e.relatedTarget instanceof Node &&
                          e.currentTarget.contains(e.relatedTarget)
                        )
                      ) {
                        setDragOverBundle(null);
                      }
                    }}
                    onDrop={(e) => void handleDropOnBundle(e, bundle.name)}
                  >
                    <div
                      className="knowledge-bundle-header"
                      onClick={() => toggleBundleExpand(bundle.name)}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <Folder size={14} className="folder-icon" />
                      {isRenamingBundle ? (
                        <input
                          type="text"
                          className="knowledge-inline-rename-input knowledge-bundle-rename-input"
                          autoFocus
                          value={renamingBundleValue}
                          onChange={(e) =>
                            setRenamingBundleValue(e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitRenameBundle();
                            } else if (e.key === "Escape") {
                              setRenamingBundle(null);
                            }
                          }}
                          onBlur={() => void submitRenameBundle()}
                        />
                      ) : (
                        <span className="bundle-name">{bundle.name}</span>
                      )}
                      <div className="bundle-hover-actions">
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          title="Rename Bundle"
                          onClick={(e) => startRenameBundle(bundle.name, e)}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          title="Add File"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddingFileBundle(
                              addingFileBundle === bundle.name
                                ? null
                                : bundle.name,
                            );
                          }}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs danger"
                          title="Delete Bundle"
                          onClick={(e) =>
                            void handleDeleteBundle(bundle.name, e)
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {addingFileBundle === bundle.name && (
                      <div
                        className="knowledge-add-file-bar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={addFileInputRef}
                          type="text"
                          autoFocus
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
                            const isRenamingThis =
                              renamingFile?.bundleName === bundle.name &&
                              renamingFile?.oldFileName === file.name;
                            return (
                              <div
                                key={file.name}
                                className={`knowledge-file-item ${
                                  isSelected ? "selected" : ""
                                } ${
                                  draggedFile?.bundleName === bundle.name &&
                                  draggedFile?.fileName === file.name
                                    ? "dragging"
                                    : ""
                                }`}
                                draggable
                                onDragStart={(e) =>
                                  handleDragFileStart(e, bundle.name, file.name)
                                }
                                onDragEnd={handleDragEndFile}
                                onClick={() =>
                                  !isRenamingThis &&
                                  void handleSelectFile(
                                    bundle.name,
                                    file.name,
                                    file.path,
                                  )
                                }
                              >
                                <FileText size={13} />
                                {isRenamingThis ? (
                                  <input
                                    type="text"
                                    className="knowledge-inline-rename-input"
                                    autoFocus
                                    value={renamingValue}
                                    onChange={(e) =>
                                      setRenamingValue(e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void submitRenameFile();
                                      } else if (e.key === "Escape") {
                                        setRenamingFile(null);
                                      }
                                    }}
                                    onBlur={() => void submitRenameFile()}
                                  />
                                ) : (
                                  <span className="file-name">{file.name}</span>
                                )}
                                <div className="file-hover-actions">
                                  <button
                                    type="button"
                                    className="btn-ghost btn-xs"
                                    title="Copy Disk Path"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(
                                        file.path,
                                        `path:${file.path}`,
                                      );
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
                                    title="Rename File"
                                    onClick={(e) =>
                                      startRenameFile(bundle.name, file.name, e)
                                    }
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-xs danger"
                                    title="Delete File"
                                    onClick={(e) =>
                                      void handleDeleteFile(
                                        bundle.name,
                                        file.name,
                                        e,
                                      )
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
                </div>
                <div
                  className="toolbar-controls"
                  style={{ position: "relative" }}
                >
                  <button
                    type="button"
                    className={`btn btn-secondary btn-sm ${
                      showMentionSourcesPopover ? "active" : ""
                    }`}
                    onClick={() => setShowMentionSourcesPopover((v) => !v)}
                    title="Manage @ Mention File Sources"
                  >
                    <Folder size={13} />
                    <span>@ Sources</span>
                  </button>

                  {showMentionSourcesPopover && (
                    <div className="knowledge-sources-popover">
                      <div className="popover-header">
                        <span>@ Mention Sources</span>
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          onClick={() => setShowMentionSourcesPopover(false)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="popover-section">
                        <div className="popover-subtitle">
                          Imported Knowledge Bundles
                        </div>
                        {bundles.length === 0 ? (
                          <div className="popover-empty">
                            No bundles imported
                          </div>
                        ) : (
                          bundles.map((bundle) => {
                            const isEnabled = !disabledBundles[bundle.name];
                            return (
                              <label key={bundle.name} className="popover-item">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() =>
                                    handleToggleMentionBundle(bundle.name)
                                  }
                                />
                                <span>{bundle.name}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <div className="popover-divider" />
                      <div className="popover-section">
                        <div className="popover-subtitle">
                          Custom Picked Disk Folders
                        </div>
                        {mentionCustomFolders.length === 0 ? (
                          <div className="popover-empty">
                            No custom folders added
                          </div>
                        ) : (
                          mentionCustomFolders.map((folderPath) => {
                            const fileMap = activeFileKey
                              ? (fileCustomFolderState[activeFileKey] ?? {})
                              : {};
                            const isFolderChecked =
                              fileMap[folderPath] !== false; // default true
                            return (
                              <label
                                key={folderPath}
                                className="popover-item-folder"
                                title={folderPath}
                              >
                                <input
                                  type="checkbox"
                                  checked={isFolderChecked}
                                  disabled={!activeFileKey}
                                  onChange={() =>
                                    handleToggleCustomFolderForFile(folderPath)
                                  }
                                />
                                <span>
                                  {folderPath
                                    .split(/[\\/]/)
                                    .filter(Boolean)
                                    .at(-1) || folderPath}
                                </span>
                                <button
                                  type="button"
                                  className="btn-ghost btn-xs danger"
                                  title="Remove Folder"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleRemoveMentionFolder(folderPath);
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <div className="popover-divider" />
                      <button
                        type="button"
                        className="popover-add-btn"
                        onClick={() => void handlePickMentionFolder()}
                      >
                        <Plus size={13} />
                        <span>Add Folder from Disk...</span>
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary btn-sm ml-2"
                    onClick={() => void handleSaveFile()}
                    disabled={saving}
                  >
                    <Save size={13} />
                    <span>{saving ? "Saving..." : "Save"}</span>
                  </button>
                </div>
              </div>

              <div
                className="knowledge-editor-body"
                style={{ position: "relative" }}
              >
                {loading ? (
                  <div className="editor-loading">Loading content...</div>
                ) : isEditing ? (
                  <div className="knowledge-cm-host" ref={editorHostRef} />
                ) : (
                  <div className="knowledge-markdown-preview">
                    <pre>{fileContent}</pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="knowledge-no-selection" />
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeScreen;
