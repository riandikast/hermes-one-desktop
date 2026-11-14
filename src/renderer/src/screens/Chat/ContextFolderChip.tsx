import { memo, useState, useEffect, useRef } from "react";
import { FolderOpen, X, Check, BookOpen, Terminal, RefreshCw } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { projectDisplayName, useProjectAliases } from "../Layout/projectAliases";
import { KNOWLEDGE_RENAMED } from "../Knowledge/knowledgeSelection";

interface ContextFolderChipProps {
  /** Working folders bound to this conversation (issue #27). */
  contextFolders: string[];
  /** Knowledge bundles attached to this session. */
  attachedKnowledgeBundles?: string[];
  /** Hidden in remote/SSH mode, where the picker browses the wrong machine. */
  show: boolean;
  onPickFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onToggleKnowledgeBundle?: (bundleName: string) => void;
  onSelectRecentFolder?: (path: string) => void;
  onSetBaseFolder?: (path: string) => void;
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
  onPickFolder,
  onRemoveFolder,
  onToggleKnowledgeBundle,
  onSelectRecentFolder,
  onSetBaseFolder,
}: ContextFolderChipProps): React.JSX.Element | null {
  const { t } = useI18n();
  useProjectAliases();
  const [isOpen, setIsOpen] = useState(false);
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [availableBundles, setAvailableBundles] = useState<Array<{ name: string; path: string }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [knowledgeRefresh, setKnowledgeRefresh] = useState(0);
  const pruneKnowledgeRef = useRef(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState(false);
  const knowledgeSelectionRef = useRef({ names: attachedKnowledgeBundles, toggle: onToggleKnowledgeBundle });
  knowledgeSelectionRef.current = { names: attachedKnowledgeBundles, toggle: onToggleKnowledgeBundle };

  useEffect(() => {
    if (!isKnowledgeOpen) return;
    let cancelled = false;
    let request = 0;
    setKnowledgeLoading(true);
    setKnowledgeError(false);
    const load = (): void => {
      const current = ++request;
      void window.hermesAPI
      .listKnowledgeBundles()
      .then((list) => {
        if (cancelled || current !== request) return;
        if (!Array.isArray(list)) throw new Error("Invalid knowledge list");
        setAvailableBundles(list);
        if (pruneKnowledgeRef.current) {
          pruneKnowledgeRef.current = false;
          const { names, toggle } = knowledgeSelectionRef.current;
          names.filter((name) => !list.some((bundle) => bundle.name === name)).forEach((name) => toggle?.(name));
        }
      })
      .catch(() => {
        if (!cancelled && current === request) setKnowledgeError(true);
      }).finally(() => { if (!cancelled && current === request) setKnowledgeLoading(false); }); };
    load();
    window.addEventListener(KNOWLEDGE_RENAMED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(KNOWLEDGE_RENAMED, load);
    };
  }, [isKnowledgeOpen, knowledgeRefresh]);

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
      <div className="chat-ctxfolder-dropdown-header" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Global Knowledge Bundles
        <button type="button" className="btn-ghost" style={{ display: "inline-flex", padding: 4 }}
          disabled={knowledgeLoading} aria-label="Refresh selection" title="Reload bundles and remove missing selections"
          onClick={() => { pruneKnowledgeRef.current = true; setKnowledgeRefresh((value) => value + 1); }}>
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
      {knowledgeError && <div role="alert" className="chat-ctxfolder-dropdown-empty">Could not refresh knowledge.</div>}
      <div className="chat-ctxfolder-dropdown-list">
        {attachedKnowledgeBundles.filter((name) => !availableBundles.some((bundle) => bundle.name === name)).map((name) => (
          <button key={`missing:${name}`} type="button" className="chat-ctxfolder-dropdown-item"
            aria-label={`Remove missing knowledge ${name}`} onClick={() => onToggleKnowledgeBundle?.(name)}>
            <span className="chat-ctxfolder-dropdown-item-name">{name} (missing)</span><X size={14} />
          </button>
        ))}
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
      {contextFolders.length > 0 && (
        <>
          <div className="chat-ctxfolder-dropdown-header">Selected</div>
          <div className="chat-ctxfolder-dropdown-list chat-ctxfolder-selected-list">
            {contextFolders.map((path, index) => {
              const isBase = index === 0;
              return (
                <button
                  key={path}
                  type="button"
                  className={`chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--active${
                    isBase ? " chat-ctxfolder-dropdown-item--base" : ""
                  }`}
                  onClick={() => onRemoveFolder(path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onSetBaseFolder?.(path);
                  }}
                  title={
                    isBase
                      ? `${path} — base folder for the terminal; click to remove`
                      : `${path} — click to remove; right-click to use as terminal base folder`
                  }
                >
                  <span className="chat-ctxfolder-dropdown-item-name">
                    {projectDisplayName(path)}
                    {isBase && (
                      <span className="chat-ctxfolder-base-label">Base</span>
                    )}
                  </span>
                  <span className="chat-ctxfolder-dropdown-item-actions">
                    {isBase && <Terminal size={12} aria-label="Terminal base folder" />}
                    <X size={12} aria-label="Remove folder" />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="chat-ctxfolder-dropdown-divider" />
        </>
      )}
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
                  {projectDisplayName(path)}
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

  return (
    <div className="chat-ctxfolder-picker" ref={containerRef}>
      <button
        className={`chat-meta-chip${attachedKnowledgeBundles.length > 0 ? " chat-meta-chip--active" : ""}`}
        onClick={() => {
          setIsOpen(false);
          setIsKnowledgeOpen((v) => !v);
        }}
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
        className={`chat-meta-chip${contextFolders.length > 0 ? " chat-meta-chip--active" : ""}`}
        onClick={() => {
          setIsKnowledgeOpen(false);
          setIsOpen((v) => !v);
        }}
        title={t("chat.setContextFolder")}
        type="button"
      >
        <FolderOpen size={13} />
        <span>
          {contextFolders.length > 0
            ? `Folder (${contextFolders.length})`
            : t("chat.contextFolderChip")}
        </span>
      </button>

      {/* The file-explorer toggle that used to sit here was removed: it
          duplicated the floating rail icon, and two controls for one panel
          disagreed about state whenever the dialog was open. */}

      {isOpen && renderDropdown()}
      {isKnowledgeOpen && renderKnowledgeDropdown()}
    </div>
  );
});
