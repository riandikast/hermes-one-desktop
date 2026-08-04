import { useState, useEffect, useRef, memo, useCallback } from "react";
import { X, FileCode, ExternalLink } from "lucide-react";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { search } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useI18n } from "../../components/useI18n";

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
}

const VIEWABLE_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
]);

const BINARY_EXTENSIONS = new Set([
  "heic",
  "heif",
  "tiff",
  "tif",
  "raw",
  "psd",
  "ai",
  "eps",
  "pdf",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "flv",
  "wmv",
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "wma",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "exe",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "msi",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
]);

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatFileSize(content: string): string {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(filename: string): boolean {
  return VIEWABLE_IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

function isBinaryFile(filename: string): boolean {
  return BINARY_EXTENSIONS.has(getFileExtension(filename));
}

/** Resolve a CodeMirror language extension by filename (extension match). */
async function resolveLanguage(filename: string): Promise<Extension | null> {
  const desc = languages.find((l) =>
    l.extensions.includes(getFileExtension(filename)),
  );
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}

export const FileViewer = memo(function FileViewer({
  filePath,
  onClose,
}: FileViewerProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstEditRef = useRef(true);

  const fileName = getFileName(filePath);

  // Debounced autosave: write the current doc back to disk.
  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const text = view.state.doc.toString();
      setSaving("saving");
      void window.hermesAPI
        .writeFile(filePathRef.current, text)
        .then((res) => setSaving(res.ok ? "saved" : "error"))
        .catch(() => setSaving("error"));
    }, 500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setImageUrl(null);
    setSaving("idle");

    const loadFile = async (): Promise<void> => {
      if (isImageFile(filePath)) {
        const imageData = await window.hermesAPI.readImageFile(filePath);
        if (cancelled) return;
        if (imageData === null) {
          setError(t("worktree.errorLoading"));
        } else {
          setImageUrl(imageData);
        }
        setIsLoading(false);
        return;
      }

      const result = await window.hermesAPI.readFile(filePath, 102400);
      if (cancelled) return;
      if (result === null) {
        setError(t("worktree.errorLoading"));
      } else {
        setContent(result.content);
        setTruncated(result.truncated);
      }
      setIsLoading(false);
    };

    void loadFile();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [filePath, t]);

  // Mount the CodeMirror editor once the content is ready and the host div
  // exists. Recreated per file path (deps include filePath).
  useEffect(() => {
    const host = editorHostRef.current;
    if (!host || content === null) return;
    let disposed = false;
    firstEditRef.current = true;
    setSaving("idle");

    void resolveLanguage(fileName).then((lang) => {
      if (disposed) return;
      const saveKeymap = Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              const view = editorViewRef.current;
              if (!view) return false;
              const text = view.state.doc.toString();
              setSaving("saving");
              void window.hermesAPI
                .writeFile(filePathRef.current, text)
                .then((res) => setSaving(res.ok ? "saved" : "error"))
                .catch(() => setSaving("error"));
              return true;
            },
          },
        ]),
      );
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: content ?? "",
          extensions: [
            basicSetup,
            oneDark,
            search({ top: true }),
            saveKeymap,
            ...(lang ? [lang] : []),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                scheduleSave();
              }
            }),
          ],
        }),
      });
      editorViewRef.current = view;
      // Store the view so the cleanup below can destroy it even though it's
      // created asynchronously (language resolution).
      (editorHostRef.current as HTMLDivElement & { _cmView?: EditorView })._cmView =
        view;
    });

    return () => {
      disposed = true;
      editorViewRef.current = null;
      const hostView = (editorHostRef.current as
        | (HTMLDivElement & { _cmView?: EditorView })
        | null)?._cmView;
      hostView?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, content === null]);

  // Escape closes the viewer, unless the CodeMirror search panel is open —
  // in that case CM's own Escape handler closes the panel first and stops
  // propagation, so the viewer stays open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        const searchOpen = document.querySelector(
          ".file-viewer-cm-host .cm-panel.cm-search",
        );
        if (!searchOpen) onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="file-viewer-overlay" onClick={onClose}>
      <div className="file-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <FileCode size={16} className="file-viewer-icon" />
            <span className="file-viewer-filename" title={filePath}>
              {fileName}
            </span>
            {(content || imageUrl) && (
              <span className="file-viewer-size">
                {content ? formatFileSize(content) : imageUrl ? "Image" : ""}
                {truncated && content && ` (${t("worktree.fileTruncated")})`}
              </span>
            )}
            {content !== null && (
              <span
                className={`file-viewer-save-state file-viewer-save-state--${saving}`}
              >
                {saving === "saving"
                  ? "Saving…"
                  : saving === "saved"
                    ? "Saved"
                    : saving === "error"
                      ? "Save failed"
                      : ""}
              </span>
            )}
          </div>
          <div className="file-viewer-actions">
            <button
              className="btn-ghost file-viewer-open"
              onClick={() => window.hermesAPI.openFileInEditor(filePath)}
              title={t("worktree.openInEditor")}
            >
              <ExternalLink size={14} />
              <span className="file-viewer-open-text">Open</span>
            </button>
            <button
              className="btn-ghost file-viewer-close"
              onClick={onClose}
              title={t("worktree.closeFile")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="file-viewer-content">
          {isLoading ? (
            <div className="file-viewer-loading">
              {t("worktree.loading")}...
            </div>
          ) : error ? (
            <div className="file-viewer-error">{error}</div>
          ) : imageUrl ? (
            <div className="file-viewer-image-container">
              <img
                src={imageUrl}
                alt={fileName}
                className="file-viewer-image"
              />
            </div>
          ) : content === null ? (
            <div className="file-viewer-error">
              {t("worktree.errorLoading")}
            </div>
          ) : isBinaryFile(fileName) ? (
            <div className="file-viewer-binary">
              <div className="file-viewer-binary-icon">📄</div>
              <div className="file-viewer-binary-text">
                Binary file cannot be previewed
              </div>
              <div className="file-viewer-binary-hint">
                Click Open to view in default application
              </div>
            </div>
          ) : (
            <>
              {truncated && (
                <div className="file-viewer-truncated">
                  {t("worktree.fileTruncatedWarning")}
                </div>
              )}
              <div className="file-viewer-cm-host" ref={editorHostRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
