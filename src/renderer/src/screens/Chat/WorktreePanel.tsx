import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Folder,
  ChevronRight,
  ChevronDown,
  SquareTerminal,
  FolderSearch,
  FileText,
  ExternalLink,
  Terminal,
} from "lucide-react";
import { getIconForFile, getSVGStringFromFileType } from "@wesbos/code-icons";
import { FileViewer } from "./FileViewer";
import { useI18n } from "../../components/useI18n";
import { rankMentions, type MentionEntry } from "./mention";

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface WorktreePanelProps {
  /** All working folders bound to this conversation (issue #27). */
  folderPaths: string[];
}

const MIN_PANEL_WIDTH = 220;
const WIDTH_STORAGE_KEY = "hermes:worktreePanelWidth";
const maxPanelWidth = (): number =>
  Math.max(MIN_PANEL_WIDTH, window.innerWidth - 360);

interface TreeItemProps {
  entry: FileEntry;
  parentPath: string;
  depth: number;
  onFileClick?: (filePath: string) => void;
  onRowContextMenu?: (
    path: string,
    isDirectory: boolean,
    x: number,
    y: number,
  ) => void;
  /** Bumped by the root panel whenever the watched folder changes on disk. */
  refreshVersion: number;
}

function FileIcon({ filename }: { filename: string }): React.JSX.Element {
  const iconType = getIconForFile(filename);
  const iconData = iconType ? getSVGStringFromFileType(iconType) : null;
  const svgString =
    iconData && typeof iconData === "object" && "svg" in iconData
      ? iconData.svg
      : "";

  return (
    <div
      className="worktree-file-icon-wrapper"
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}

function TreeItem({
  entry,
  parentPath,
  depth,
  onFileClick,
  onRowContextMenu,
  refreshVersion,
}: TreeItemProps): React.JSX.Element {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fullPath = `${parentPath}/${entry.name}`;

  const [childrenVersion, setChildrenVersion] = useState(0);

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory) return;
    if (children !== null && childrenVersion === refreshVersion) return;
    setIsLoading(true);
    const result = await window.hermesAPI.readDirectory(fullPath);
    if (result) {
      // Sort: directories first, then files, both alphabetically
      const sorted = result.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });
      setChildren(sorted);
    }
    setChildrenVersion(refreshVersion);
    setIsLoading(false);
  }, [entry.isDirectory, fullPath, children, childrenVersion, refreshVersion]);

  // Live refresh: refetch already-loaded children when the folder changed
  useEffect(() => {
    if (children !== null && childrenVersion !== refreshVersion) {
      void loadChildren();
    }
  }, [refreshVersion, children, childrenVersion, loadChildren]);

  const handleClick = (): void => {
    if (entry.isDirectory) {
      if (!isExpanded) {
        void loadChildren();
      }
      setIsExpanded(!isExpanded);
    } else {
      onFileClick?.(fullPath);
    }
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    onRowContextMenu?.(fullPath, entry.isDirectory, e.clientX, e.clientY);
  };

  const paddingLeft = 8 + depth * 12;

  return (
    <div className="worktree-item">
      <div
        className={`worktree-row ${!entry.isDirectory ? "worktree-row-file" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft }}
        title={fullPath}
      >
        {entry.isDirectory ? (
          <>
            <span className="worktree-chevron">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <Folder size={14} className="worktree-icon worktree-folder-icon" />
          </>
        ) : (
          <>
            <span className="worktree-chevron-placeholder" />
            <FileIcon filename={entry.name} />
          </>
        )}
        <span className="worktree-name">{entry.name}</span>
      </div>
      {entry.isDirectory && isExpanded && (
        <div className="worktree-children">
          {isLoading ? (
            <div
              className="worktree-loading"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              {t("chat.worktree.loading")}...
            </div>
          ) : children === null ? null : children.length === 0 ? (
            <div
              className="worktree-empty"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              {t("chat.worktree.emptyFolder")}
            </div>
          ) : (
            children.map((child) => (
              <TreeItem
                key={`${fullPath}/${child.name}`}
                entry={child}
                parentPath={fullPath}
                depth={depth + 1}
                onFileClick={onFileClick}
                onRowContextMenu={onRowContextMenu}
                refreshVersion={refreshVersion}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface RootSectionProps {
  folderPath: string;
  onFileClick: (filePath: string) => void;
  onRowContextMenu: (
    path: string,
    isDirectory: boolean,
    x: number,
    y: number,
  ) => void;
  onOpenTerminal: (path: string) => Promise<void>;
  refreshVersion: number;
}

/** One collapsible root in the multi-root sidebar. */
function RootSection({
  folderPath,
  onFileClick,
  onRowContextMenu,
  onOpenTerminal,
  refreshVersion,
}: RootSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(true);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadRoot = async (): Promise<void> => {
      const result = await window.hermesAPI.readDirectory(folderPath);
      if (cancelled) return;
      if (result === null) {
        setError(t("chat.worktree.errorLoading"));
      } else {
        // Sort: directories first, then files, both alphabetically
        const sorted = result.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory ? -1 : 1;
        });
        setEntries(sorted);
      }
      setIsLoading(false);
    };

    void loadRoot();
    return () => {
      cancelled = true;
    };
  }, [folderPath, refreshVersion, t]);

  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    onRowContextMenu(folderPath, true, e.clientX, e.clientY);
  };

  return (
    <div className="worktree-root">
      <div
        className="worktree-root-header"
        onClick={() => setIsExpanded((v) => !v)}
        onContextMenu={handleContextMenu}
        title={folderPath}
      >
        <span className="worktree-chevron">
          {isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </span>
        <Folder size={14} className="worktree-icon worktree-folder-icon" />
        <span className="worktree-root-name">{folderName}</span>
        <button
          type="button"
          className="btn-ghost worktree-header-action"
          onClick={(e) => {
            e.stopPropagation();
            void onOpenTerminal(folderPath);
          }}
          aria-label={t("chat.worktree.openTerminal")}
          title={t("chat.worktree.openTerminal")}
        >
          <SquareTerminal size={16} />
        </button>
      </div>
      {isExpanded && (
        <div className="worktree-children">
          {isLoading ? (
            <div className="worktree-loading">
              {t("chat.worktree.loading")}...
            </div>
          ) : error ? (
            <div className="worktree-error">{error}</div>
          ) : entries === null || entries.length === 0 ? (
            <div className="worktree-empty">{t("chat.worktree.empty")}</div>
          ) : (
            entries.map((entry) => (
              <TreeItem
                key={`${folderPath}/${entry.name}`}
                entry={entry}
                parentPath={folderPath}
                depth={0}
                onFileClick={onFileClick}
                onRowContextMenu={onRowContextMenu}
                refreshVersion={refreshVersion}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Parent directory of a tree path (paths are "/"-joined even on Windows). */
function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

interface ContextMenuState {
  /** Directory to act on. */
  path: string;
  x: number;
  y: number;
}

export const WorktreePanel = memo(function WorktreePanel({
  folderPaths,
}: WorktreePanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH ? saved : 240;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent): void => {
      // Panel sits on the right edge, so dragging the handle left widens it.
      const delta = startX - ev.clientX;
      nextWidth = Math.min(
        maxPanelWidth(),
        Math.max(MIN_PANEL_WIDTH, startWidth + delta),
      );
      setWidth(nextWidth);
    };
    const onUp = (): void => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const [refreshVersion, setRefreshVersion] = useState(0);

  // Live-update: watch every root in the main process, re-scan on changes
  useEffect(() => {
    for (const folder of folderPaths) {
      void window.hermesAPI.watchContextFolder(folder);
    }
    return window.hermesAPI.onContextFolderChanged(() => {
      setRefreshVersion((v) => v + 1);
    });
  }, [folderPaths]);

  // --- Search across all roots (flat ranked list, top 50) ---
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MentionEntry[] | null>(
    null);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      let cancelled = false;
      const runSearch = async (): Promise<void> => {
        const seen = new Set<string>();
        const all: MentionEntry[] = [];
        for (const folder of folderPaths) {
          const list = await window.hermesAPI.listFilesRecursive(folder);
          if (cancelled || !list) continue;
          for (const e of list) {
            if (!e.path || seen.has(e.path)) continue;
            seen.add(e.path);
            all.push({ name: e.name, isDirectory: e.isDirectory, path: e.path });
          }
        }
        if (cancelled) return;
        const ranked = rankMentions(trimmed, all, false).slice(0, 50);
        setSearchResults(ranked);
        setSearching(false);
      };
      void runSearch();
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, folderPaths]);

  // Dismiss the context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (): void => setContextMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const handleRowContextMenu = useCallback(
    (path: string, isDirectory: boolean, clientX: number, clientY: number) => {
      // For files, the explorer/terminal targets are the parent directory.
      const target = isDirectory ? path : parentDir(path);
      const bounds = document
        .querySelector(".worktree-panel")
        ?.getBoundingClientRect();
      const left = bounds ? clientX - bounds.left : clientX;
      const top = bounds ? clientY - bounds.top : clientY;
      setContextMenu({
        path: target,
        x: Math.min(left, Math.max(0, width - 200)),
        y: top,
      });
    },
    [width],
  );

  const handleOpenTerminal = async (path: string): Promise<void> => {
    setTerminalError(null);
    const opened = await window.hermesAPI.openTerminal(path);
    if (!opened) setTerminalError(t("chat.worktree.openTerminalFailed"));
    setContextMenu(null);
  };

  const handleRevealInExplorer = (path: string): void => {
    void window.hermesAPI.revealInExplorer(path);
    setContextMenu(null);
  };

  const searchPending = searching || query.trim().length > 0;
  const showingSearch = searchResults !== null || searchPending;

  return (
    <div className="worktree-panel" style={{ width }}>
      <div
        className={`worktree-resize-handle ${
          isResizing ? "worktree-resize-handle-active" : ""
        }`}
        onPointerDown={startResize}
        title="Drag to resize"
      />
      <div className="worktree-header">
        <FolderSearch size={16} className="worktree-header-icon" />
        <span className="worktree-header-title">
          {t("chat.worktree.title")}
        </span>
      </div>
      <div className="worktree-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chat.worktree.searchPlaceholder")}
          className="worktree-search-input"
        />
      </div>
      {terminalError && (
        <div className="worktree-terminal-error">{terminalError}</div>
      )}
      <div className="worktree-content">
        {showingSearch ? (
          searchResults === null ? (
            <div className="worktree-loading">
              {t("chat.worktree.searching")}...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="worktree-empty">
              {t("chat.worktree.noResults")}
            </div>
          ) : (
            searchResults.map((entry) => (
              <div
                key={entry.path}
                className="worktree-row worktree-row-file worktree-search-result"
                onClick={() => {
                  if (!entry.isDirectory) setSelectedFile(entry.path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleRowContextMenu(
                    entry.path,
                    entry.isDirectory,
                    e.clientX,
                    e.clientY,
                  );
                }}
                title={entry.path}
              >
                <span className="worktree-chevron-placeholder" />
                {entry.isDirectory ? (
                  <Folder
                    size={14}
                    className="worktree-icon worktree-folder-icon"
                  />
                ) : (
                  <FileText
                    size={14}
                    className="worktree-icon worktree-file-icon"
                  />
                )}
                <span className="worktree-name">
                  {entry.name}
                  <span className="worktree-search-path">
                    {" "}
                    — {truncateSearchPath(entry.path)}
                  </span>
                </span>
              </div>
            ))
          )
        ) : folderPaths.length === 0 ? (
          <div className="worktree-empty">{t("chat.worktree.empty")}</div>
        ) : (
          folderPaths.map((folder) => (
            <RootSection
              key={folder}
              folderPath={folder}
              onFileClick={setSelectedFile}
              onRowContextMenu={handleRowContextMenu}
              onOpenTerminal={handleOpenTerminal}
              refreshVersion={refreshVersion}
            />
          ))
        )}
      </div>
      {contextMenu && (
        <div
          className="worktree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="worktree-context-menu-item"
            onClick={() => handleRevealInExplorer(contextMenu.path)}
          >
            <ExternalLink size={14} />
            <span>{t("chat.worktree.revealInExplorer")}</span>
          </button>
          <button
            type="button"
            className="worktree-context-menu-item"
            onClick={() => void handleOpenTerminal(contextMenu.path)}
          >
            <Terminal size={14} />
            <span>{t("chat.worktree.openTerminal")}</span>
          </button>
        </div>
      )}
      {selectedFile && (
        <FileViewer
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
});

function truncateSearchPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}
