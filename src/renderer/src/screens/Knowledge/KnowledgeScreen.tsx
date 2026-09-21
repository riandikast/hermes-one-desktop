import { useEffect, useState, useCallback, useRef } from "react";
import { findMention } from "../Chat/mention";
import { searchHighlights } from "../Chat/editorSearch";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
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
  ArrowLeft,
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

  // ── Drill-down navigation ────────────────────────────────────────────────
  // The panes are no longer side by side: ONE full-width surface shows either
  // the bundle grid, that bundle's file list, or the open file's editor, each
  // with a back control. The view is DERIVED from selectedFile/openBundle
  // rather than kept as separate state, so the two can never disagree (e.g.
  // an editor open with no bundle behind it to go back to).
  const [openBundle, setOpenBundle] = useState<string | null>(null);
  const view: "bundles" | "files" | "editor" = selectedFile
    ? "editor"
    : openBundle
      ? "files"
      : "bundles";
  // The bundle currently being browsed: the open one, or the selected file's.
  const activeBundleName = openBundle ?? selectedFile?.bundleName ?? null;
  const activeBundle = activeBundleName
    ? (bundles.find((b) => b.name === activeBundleName) ?? null)
    : null;

  const openBundleFiles = (bundleName: string): void => {
    setOpenBundle(bundleName);
  };

  // Back from the editor returns to that file's bundle list, not the grid, so
  // a user editing several files in one bundle does not re-drill each time.
  const backFromEditor = (): void => {
    setOpenBundle(selectedFile?.bundleName ?? openBundle);
    setSelectedFile(null);
  };

  const backToBundles = (): void => {
    setOpenBundle(null);
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
          // Same VS Code-style feedback as the file editor: highlight every
          // match (stock search() marks only the active one).
          searchHighlights(() => undefined),
          // IDE behavior: Tab indents/inserts a tab instead of moving focus
          // (the default browser behavior in a webview). Shift-Tab outdents.
          keymap.of([indentWithTab]),
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

  const handleSelectFile = async (
    bundleName: string,
    fileName: string,
    path: string,
  ) => {
    setLoading(true);
    // Drilling into a file also opens its bundle, so "back" from the editor
    // lands on the file list rather than skipping to the grid.
    setOpenBundle(bundleName);
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
      // A freshly created bundle is empty, so drill straight into its file
      // list: the next action is always adding the first file.
      setOpenBundle(trimmed);
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
        // Re-key the drill-down pointer so a rename cannot strand the view on
        // a bundle name that no longer exists.
        setOpenBundle((prev) => (prev === oldName ? trimmed : prev));
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
    e: React.DragEvent<HTMLElement>,
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
        {/* ── Bundles grid (full width) ─────────────────────────────────── */}
        {view === "bundles" && (
          <div className="knowledge-drill">
            <div className="knowledge-drill-head">
              <span className="knowledge-drill-title">
                Global Knowledge Bundles
              </span>
              <span className="knowledge-drill-count">
                {bundles.length} bundle{bundles.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="knowledge-drill-scroll">
              <div className="knowledge-bundle-list">
                {bundles.map((bundle) => {
                  const isRenamingBundle = renamingBundle === bundle.name;
                  const fileCount = bundle.files.length;
                  const fileLabel =
                    fileCount === 0
                      ? "No files yet"
                      : `${fileCount} file${fileCount === 1 ? "" : "s"}`;
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
                      {/* Card front: icon, title, summary, count, action.
                          Clicking the card DRILLS IN to the file list. */}
                      <div
                        className="knowledge-bundle-card"
                        onClick={() => openBundleFiles(bundle.name)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openBundleFiles(bundle.name);
                          }
                        }}
                      >
                        <div className="knowledge-bundle-card-top">
                          <span className="knowledge-bundle-card-icon">
                            <BookOpen size={22} />
                          </span>
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
                          <div className="knowledge-bundle-card-title">
                            {bundle.name}
                          </div>
                        )}

                        <div className="knowledge-bundle-card-sub">
                          {fileLabel}
                        </div>

                        <span className="knowledge-bundle-card-pill">
                          Open
                          <ChevronRight size={12} />
                        </span>
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
                              e.key === "Enter" &&
                              void handleAddFile(bundle.name)
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
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── File list for one bundle (full width, with Back) ──────────── */}
        {view === "files" && activeBundle && (
          <div className="knowledge-drill">
            <div className="knowledge-drill-head">
              <button
                type="button"
                className="knowledge-back-btn"
                onClick={backToBundles}
                aria-label="Back to bundles"
                title="Back to bundles"
              >
                <ArrowLeft size={14} />
                <span>Bundles</span>
              </button>
              <span className="knowledge-drill-title">
                {activeBundle.name}
              </span>
              <span className="knowledge-drill-count">
                {activeBundle.files.length} file
                {activeBundle.files.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="knowledge-drill-scroll">
              {activeBundle.files.length === 0 ? (
                <div className="knowledge-drill-empty">
                  <p>No files in this bundle yet.</p>
                  <p className="knowledge-drill-empty-hint">
                    Click the + on the bundle card to add one.
                  </p>
                </div>
              ) : (
                <ul className="knowledge-file-grid">
                  {activeBundle.files.map((file) => {
                    const isRenamingThis =
                      renamingFile?.bundleName === activeBundle.name &&
                      renamingFile?.oldFileName === file.name;
                    return (
                      <li
                        key={file.name}
                        className="knowledge-file-card"
                        draggable
                        onDragStart={(e) =>
                          handleDragFileStart(e, activeBundle.name, file.name)
                        }
                        onDragEnd={handleDragEndFile}
                      >
                        <button
                          type="button"
                          className="knowledge-file-card-open"
                          onClick={() =>
                            !isRenamingThis &&
                            void handleSelectFile(
                              activeBundle.name,
                              file.name,
                              file.path,
                            )
                          }
                        >
                          <FileText size={20} />
                          {isRenamingThis ? (
                            <input
                              type="text"
                              className="knowledge-inline-rename-input"
                              autoFocus
                              value={renamingValue}
                              onChange={(e) => setRenamingValue(e.target.value)}
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
                            <span className="knowledge-file-card-name">
                              {file.name}
                            </span>
                          )}
                        </button>
                        <div className="knowledge-file-card-actions">
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
                            title="Rename File"
                            onClick={(e) =>
                              startRenameFile(activeBundle.name, file.name, e)
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
                                activeBundle.name,
                                file.name,
                                e,
                              )
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ── Editor (full width, with Back) ───────────────────────────── */}
        {view === "editor" && selectedFile && (
          <div className="knowledge-editor-pane">
            <div className="knowledge-editor-container">
                <div className="knowledge-editor-toolbar">
                  <div className="file-info">
                    <button
                      type="button"
                      className="knowledge-back-btn"
                      onClick={backFromEditor}
                      aria-label="Back to file list"
                      title="Back to file list"
                    >
                      <ArrowLeft size={14} />
                      <span>{selectedFile.bundleName}</span>
                    </button>
                    <FileText size={16} />
                    <span className="file-title">{selectedFile.fileName}</span>
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
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeScreen;
