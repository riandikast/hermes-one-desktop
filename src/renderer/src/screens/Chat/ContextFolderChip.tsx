import { memo, useState, useEffect, useRef, Fragment } from "react";
import { FolderOpen, FolderTree, X, Check, Plus, BookOpen } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface ContextFolderChipProps {
  /** Working folders bound to this conversation (issue #27). */
  contextFolders: string[];
  /** Knowledge bundles attached to this session. */
  attachedKnowledgeBundles?: string[];
  /** Hidden in remote/SSH mode, where the picker browses the wrong machine. */
  show: boolean;
  worktreeVisible: boolean;
  onPickFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onRemoveKnowledgeBundle?: (bundleName: string) => void;
  onToggleKnowledgeBundle?: (bundleName: string) => void;
  onToggleWorktree: () => void;
  onSelectRecentFolder?: (path: string) => void;
}

/** Last path segment, for the compact chip label (handles \ and /). */
function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Context-folder control rendered as a chip in the input footer, next to the
 * model picker (both share the `.chat-meta-chip` style). When clicked, opens a
 * dropdown popup showing recent project folders and an "Open folder..." option.
 */
export const ContextFolderChip = memo(function ContextFolderChip({
  contextFolders,
  attachedKnowledgeBundles = [],
  show,
  worktreeVisible,
  onPickFolder,
  onRemoveFolder,
  onRemoveKnowledgeBundle,
  onToggleKnowledgeBundle,
  onToggleWorktree,
  onSelectRecentFolder,
}: ContextFolderChipProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [availableBundles, setAvailableBundles] = useState<Array<{ name: string; path: string }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isKnowledgeOpen) return;
    let cancelled = false;
    void window.hermesAPI
      .listKnowledgeBundles()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setAvailableBundles(list);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [isKnowledgeOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void window.hermesAPI
      .listRecentSessionContextFolders(20)
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setRecentFolders(list);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && !isKnowledgeOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setIsKnowledgeOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
        setIsKnowledgeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, isKnowledgeOpen]);

  if (!show) return null;

  const handleImportKnowledgeFolder = async () => {
    try {
      const folderPath = await window.hermesAPI.selectFolder();
      if (!folderPath) return;
      const parts = folderPath.split(/[\\/]/).filter(Boolean);
      const folderName = parts.at(-1) || "imported-knowledge";
      const bundle = await window.hermesAPI.importKnowledgeFolder(folderPath, folderName);
      if (bundle?.name) {
        onToggleKnowledgeBundle?.(bundle.name);
      }
      setIsKnowledgeOpen(false);
    } catch {
      /* ignore */
    }
  };

  const renderKnowledgeDropdown = (): React.JSX.Element => (
    <div className="chat-ctxfolder-dropdown">
      <div className="chat-ctxfolder-dropdown-header">Global Knowledge Bundles</div>
      <div className="chat-ctxfolder-dropdown-list">
        {availableBundles.length === 0 ? (
          <div className="chat-ctxfolder-dropdown-empty">No knowledge bundles</div>
        ) : (
          availableBundles.map((bundle) => {
            const isAttached = attachedKnowledgeBundles.includes(bundle.name);
            return (
              <button
                key={bundle.name}
                type="button"
                className={`chat-ctxfolder-dropdown-item${
                  isAttached ? " chat-ctxfolder-dropdown-item--active" : ""
                }`}
                onClick={() => {
                  onToggleKnowledgeBundle?.(bundle.name);
                }}
                title={bundle.path}
              >
                <span className="chat-ctxfolder-dropdown-item-name">
                  {bundle.name}
                </span>
                {isAttached && (
                  <Check
                    size={14}
                    className="chat-ctxfolder-dropdown-item-check"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="chat-ctxfolder-dropdown-divider" />
      <button
        type="button"
        className="chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--open"
        onClick={() => void handleImportKnowledgeFolder()}
      >
        <span>Import Knowledge Folder...</span>
      </button>
    </div>
  );

  const renderDropdown = (): React.JSX.Element => (
    <div className="chat-ctxfolder-dropdown">
      <div className="chat-ctxfolder-dropdown-header">Recent</div>
      <div className="chat-ctxfolder-dropdown-list">
        {recentFolders.length === 0 ? (
          <div className="chat-ctxfolder-dropdown-empty">No recent folders</div>
        ) : (
          recentFolders.map((path) => {
            const isSelected = contextFolders.includes(path);
            return (
              <button
                key={path}
                type="button"
                className={`chat-ctxfolder-dropdown-item${
                  isSelected ? " chat-ctxfolder-dropdown-item--active" : ""
                }`}
                onClick={() => {
                  onSelectRecentFolder?.(path);
                  setIsOpen(false);
                }}
                title={path}
              >
                <span className="chat-ctxfolder-dropdown-item-name">
                  {folderName(path)}
                </span>
                {isSelected && (
                  <Check
                    size={14}
                    className="chat-ctxfolder-dropdown-item-check"
                  />
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="chat-ctxfolder-dropdown-divider" />
      <button
        type="button"
        className="chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--open"
        onClick={() => {
          setIsOpen(false);
          onPickFolder();
        }}
      >
        <span>Open folder...</span>
      </button>
    </div>
  );

  if (contextFolders.length === 0) {
    return (
      <div className="chat-ctxfolder-picker" ref={containerRef}>
        <button
          className={`chat-meta-chip${attachedKnowledgeBundles.length > 0 ? " chat-meta-chip--active" : ""}`}
          onClick={() => setIsKnowledgeOpen((v) => !v)}
          title="Manage Attached Knowledge Bundles"
          type="button"
        >
          <BookOpen size={13} />
          <span>
            {attachedKnowledgeBundles.length > 0
              ? `Knowledge (${attachedKnowledgeBundles.length})`
              : "Knowledge"}
          </span>
        </button>

        <button
          className="chat-meta-chip"
          onClick={() => setIsOpen((v) => !v)}
          title={t("chat.setContextFolder")}
          type="button"
        >
          <FolderOpen size={13} />
          <span>{t("chat.contextFolderChip")}</span>
        </button>
        {isOpen && renderDropdown()}
        {isKnowledgeOpen && renderKnowledgeDropdown()}
      </div>
    );
  }

  return (
    <div className="chat-ctxfolder-group" ref={containerRef}>
      <button
        className={`chat-meta-chip${attachedKnowledgeBundles.length > 0 ? " chat-meta-chip--active" : ""}`}
        onClick={() => setIsKnowledgeOpen((v) => !v)}
        title="Manage Attached Knowledge Bundles"
        type="button"
      >
        <BookOpen size={13} />
        <span>
          {attachedKnowledgeBundles.length > 0
            ? `Knowledge (${attachedKnowledgeBundles.length})`
            : "Knowledge"}
        </span>
      </button>

      {attachedKnowledgeBundles.map((bundleName) => (
        <Fragment key={`kb-${bundleName}`}>
          <div
            className="chat-meta-chip chat-meta-chip--active"
            title={`Attached Knowledge: ${bundleName}`}
          >
            <BookOpen size={13} />
            <span className="chat-ctxfolder-name">{bundleName}</span>
          </div>
          <button
            className="chat-meta-chip-icon"
            onClick={() => onRemoveKnowledgeBundle?.(bundleName)}
            title="Detach Knowledge Bundle"
            type="button"
          >
            <X size={11} />
          </button>
        </Fragment>
      ))}

      {contextFolders.map((folder) => (
        <Fragment key={folder}>
          <button
            className="chat-meta-chip chat-meta-chip--active"
            onClick={() => setIsOpen((v) => !v)}
            title={t("chat.contextFolderActive", { path: folder })}
            type="button"
          >
            <FolderOpen size={13} />
            <span className="chat-ctxfolder-name">{folderName(folder)}</span>
          </button>
          <button
            className="chat-meta-chip-icon"
            onClick={() => onRemoveFolder(folder)}
            title={t("chat.removeContextFolder")}
            type="button"
          >
            <X size={11} />
          </button>
        </Fragment>
      ))}
      <button
        className="chat-meta-chip-icon"
        onClick={() => setIsOpen((v) => !v)}
        title={t("chat.addContextFolder")}
        type="button"
      >
        <Plus size={13} />
      </button>
      <button
        className={`chat-meta-chip-icon${
          worktreeVisible ? " chat-meta-chip-icon--active" : ""
        }`}
        onClick={onToggleWorktree}
        title={
          worktreeVisible ? t("chat.hideWorktree") : t("chat.showWorktree")
        }
        type="button"
      >
        <FolderTree size={13} />
      </button>
      {isOpen && renderDropdown()}
      {isKnowledgeOpen && renderKnowledgeDropdown()}
    </div>
  );
});
