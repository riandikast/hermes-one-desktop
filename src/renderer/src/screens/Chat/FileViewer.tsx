import { useState, useEffect, useRef, memo, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { search } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { useI18n } from "../../components/useI18n";

interface FileViewerProps {
  filePath: string;
  /** True while this file is the active tab. Inactive tabs stay mounted
   *  (their CodeMirror editor and unsaved edits survive switching) but are
   *  hidden with `display: none`. */
  active: boolean;
  /** 1-based line to jump to once the file loads (Find in Files). */
  initialLine?: number;
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
  active,
  initialLine,
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
  const doSave = useCallback(async (): Promise<void> => {
    const view = editorViewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    setSaving("saving");
    try {
      // Guard against a stale preload (old app instance): invoking an
      // undefined bridge method throws synchronously and would leave the
      // indicator stuck on "Saving…" forever.
      if (typeof window.hermesAPI.writeFile !== "function") {
        console.error("FileViewer: hermesAPI.writeFile missing (stale app?)");
        setSaving("error");
        return;
      }
      const res = await window.hermesAPI.writeFile(filePathRef.current, text);
      setSaving(res.ok ? "saved" : "error");
      if (!res.ok) {
        console.error("FileViewer: write failed", res.error);
      }
    } catch (err) {
      console.error("FileViewer: write threw", err);
      setSaving("error");
    }
  }, []);

  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSave();
    }, 500);
  }, [doSave]);

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

      // Effectively unlimited: the editor must see the whole file, otherwise
      // autosave would write back only the capped prefix and destroy the rest.
      // MAX_SAFE_INTEGER (not 0) — an app running the older read-file handler
      // treats maxBytes ?? 102400 as literal 0 when 0 is passed, truncating
      // every file to empty.
      const result = await window.hermesAPI.readFile(
        filePath,
        Number.MAX_SAFE_INTEGER,
      );
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
              void doSave();
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
            // IDE behavior: Tab indents/inserts a tab instead of moving focus
            // (the default browser behavior in a webview). Shift-Tab outdents.
            keymap.of([indentWithTab]),
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
      (
        editorHostRef.current as HTMLDivElement & { _cmView?: EditorView }
      )._cmView = view;
    });

    return () => {
      disposed = true;
      editorViewRef.current = null;
      const hostView = (
        editorHostRef.current as
          | (HTMLDivElement & { _cmView?: EditorView })
          | null
      )?._cmView;
      hostView?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, content === null]);

  // Jump to a line (Find in Files result) once the editor is ready. Runs when
  // the line changes or the file finishes loading; guards against the editor
  // still being created (language resolution is async).
  useEffect(() => {
    if (!initialLine) return;
    const tryJump = (): void => {
      const view = editorViewRef.current;
      if (!view) return;
      const line = Math.max(1, Math.min(initialLine, view.state.doc.lines));
      const pos = view.state.doc.line(line).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      view.focus();
    };
    tryJump();
    const t = window.setTimeout(tryJump, 120);
    return () => window.clearTimeout(t);
  }, [initialLine, content === null]);

  // Escape closes the editor panel, unless the CodeMirror search panel is
  // open — in that case CM's own Escape handler closes the panel first and
  // stops propagation, so the editor stays open.
  useEffect(() => {
    if (!active) return;
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
  }, [active, onClose]);

  return (
    <div
      className={`file-editor-body${active ? "" : " file-editor-body--hidden"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="file-viewer-content">
        {isLoading ? (
          <div className="file-viewer-loading">{t("worktree.loading")}...</div>
        ) : error ? (
          <div className="file-viewer-error">{error}</div>
        ) : imageUrl ? (
          <div className="file-viewer-image-container">
            <img src={imageUrl} alt={fileName} className="file-viewer-image" />
          </div>
        ) : content === null ? (
          <div className="file-viewer-error">{t("worktree.errorLoading")}</div>
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
      <div className="file-viewer-statusbar">
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
        <button
          type="button"
          className="btn-ghost file-viewer-open"
          onClick={() => window.hermesAPI.openFileInEditor(filePath)}
          title={t("worktree.openInEditor")}
        >
          <ExternalLink size={13} />
          <span className="file-viewer-open-text">Open</span>
        </button>
      </div>
    </div>
  );
});
