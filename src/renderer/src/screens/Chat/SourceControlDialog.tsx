import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appConfirm } from "../../components/modal/appConfirm";
import { createPortal } from "react-dom";
import {
  X,
  GitBranch,
  RefreshCw,
  GitCommitHorizontal,
  FileDiff,
  EyeOff,
  LoaderCircle,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  BookOpen,
  Maximize2,
  PictureInPicture2,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { matchesShortcut, shortcutLabel } from "../../utils/keyboardShortcuts";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import { DiffViewer } from "./DiffViewer";
import { CommitGraph } from "./CommitGraph";
import { IgnoredFiles } from "./IgnoredFiles";
import { StashSection } from "./StashSection";
import { BranchDialog } from "./BranchDialog";
import { RenameCommitDialog } from "./RenameCommitDialog";
import { GitDoc } from "./GitDoc";
import { SourceControlSplit } from "./SourceControlSplit";
import { FloatingDialog } from "./FloatingDialog";
import { useSourceControlTerminals } from "./useSourceControlTerminals";
import { TerminalDock } from "../Command/TerminalDock";
import type { GraphCommit } from "./gitGraph";

interface GitFileEntry {
  index: string;
  worktree: string;
  path: string;
}

interface GitStatusResult {
  repo: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  conflicted: GitFileEntry[];
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  reverting?: boolean;
  error?: string;
}

interface GitActionResult {
  ok: boolean;
  output?: string;
  error?: string;
}

const fileLabel = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Below this panel width the side-by-side diff split becomes tabs. */
export const SOURCE_CONTROL_NARROW_WIDTH = 760;
export function isNarrowSourceControl(width: number): boolean {
  return width > 0 && width < SOURCE_CONTROL_NARROW_WIDTH;
}

function statusCode(entry: { index: string; worktree: string }): string {
  if (entry.index !== " ") return entry.index;
  return entry.worktree;
}

/**
 * Full-page wrapper, portaled to <body>.
 *
 * HOISTED to module scope on purpose. It used to be defined inside
 * `SourceControlDialog`'s body, which gave it a NEW function identity on every
 * render — React treats a changed component type as a different component and
 * remounts the subtree. `Shell` wraps the entire dialog, so the commit textarea
 * was destroyed and recreated on every keystroke, losing focus after each
 * character. Any component defined inline has this defect; keep these stable.
 *
 * A full-page panel, not a modal: it fills the window and escapes the
 * FloatingDialog it is mounted inside (whose body clips and stacks it, which
 * cropped the bottom and double-chromed it with a second header).
 */
function Shell({
  children,
  floating = false,
  title = "Source Control",
  onClose,
}: {
  children: React.ReactNode;
  floating?: boolean;
  title?: string;
  onClose?: () => void;
}): React.JSX.Element {
  if (floating && onClose) {
    // Same draggable/resizable window as the terminal and web preview. It still
    // portals to <body>, so it clears the chat's stacking context.
    return createPortal(
      <FloatingDialog
        open
        title={title}
        size="wide"
        onClose={onClose}
        className="source-control-floating"
      >
        {children}
      </FloatingDialog>,
      document.body,
    );
  }
  return createPortal(
    <div className="source-control-page">{children}</div>,
    document.body,
  );
}

function Section({ title, toolbar, children, contextAction, contextDisabled = false, selectionLabel, allSelected = false, selectionDisabled = false, onToggleSelection }: {
  title: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  contextAction?: () => void;
  contextDisabled?: boolean;
  selectionLabel?: string;
  allSelected?: boolean;
  selectionDisabled?: boolean;
  onToggleSelection?: () => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const heading = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenu(null);
        heading.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  const openMenu = (x: number, y: number) => setMenu({
    x: Math.max(0, Math.min(x, window.innerWidth - 210)),
    y: Math.max(0, Math.min(y, window.innerHeight - 48)),
  });
  return (
    <details className="source-control-section" open>
      <summary ref={heading} className="source-control-section-title"
        aria-haspopup={contextAction ? "menu" : undefined}
        onContextMenu={contextAction ? (event) => { event.preventDefault(); openMenu(event.clientX, event.clientY); } : undefined}
        onKeyDown={contextAction ? (event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.left, rect.bottom);
          }
        } : undefined}>
        <ChevronRight className="source-control-chevron-closed" size={14} aria-hidden="true" />
        <ChevronDown className="source-control-chevron-open" size={14} aria-hidden="true" />
        {title}
      </summary>
      {(toolbar || onToggleSelection) && <div className="source-control-section-toolbar">
        {onToggleSelection && <button type="button" className="btn-ghost btn-sm"
          aria-label={`${allSelected ? "Unselect" : "Select"} all ${selectionLabel}`}
          aria-pressed={allSelected} disabled={selectionDisabled} onClick={onToggleSelection}>
          {allSelected ? "Unselect all" : "Select all"}
        </button>}
        {toolbar}
      </div>}
      {children}
      {menu && createPortal(
        <div ref={menuRef} role="menu" aria-label="Changes actions" className="worktree-context-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y, width: 210, maxWidth: "100vw", zIndex: 2000 }}
          onKeyDown={(event) => {
            if (event.key === "Tab") { setMenu(null); heading.current?.focus(); }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
          }}>
          <button type="button" role="menuitem" className="worktree-context-menu-item" disabled={contextDisabled}
            onClick={() => { setMenu(null); heading.current?.focus(); contextAction?.(); }}>
            Stage all changes
          </button>
        </div>, document.body,
      )}
    </details>
  );
}

/**
 * One changed file row. Module scope, like Shell — see the note there.
 * Takes the dialog's `selected`/`busy` state and its handlers as props rather
 * than closing over them, so it has a stable identity across renders.
 */
function FileRow({
  path,
  entry,
  staged,
  isConflict,
  active,
  selectedForBatch,
  busy,
  onShowDiff,
  onSelectForBatch,
  onToggleStaged,
  onResolveConflict,
  onIgnore,
  onDiscard,
}: {
  path: string;
  entry?: { index: string; worktree: string };
  staged: boolean;
  isConflict?: boolean;
  active: boolean;
  selectedForBatch: boolean;
  busy: boolean;
  onShowDiff: (path: string, staged: boolean) => void;
  onSelectForBatch: (path: string, staged: boolean, shift: boolean, isConflict?: boolean) => void;
  onToggleStaged: (path: string, staged: boolean) => void;
  onResolveConflict: (path: string, side: "ours" | "theirs") => void;
  onIgnore: (path: string) => void;
  onDiscard: (path: string) => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canDiscard = !isConflict && !staged && entry?.index === " " && entry.worktree === "M";
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault(); event.stopImmediatePropagation();
        setMenu(null); row.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", key, true);
    };
  }, [menu]);
  const openMenu = (x: number, y: number) => setMenu({
    x: Math.max(0, Math.min(x, window.innerWidth - 210)),
    y: Math.max(0, Math.min(y, window.innerHeight - 48)),
  });
  return (
    <div ref={row} className={`source-control-file${active ? " active" : ""}${selectedForBatch ? " selected" : ""}`}
      onContextMenu={canDiscard ? (event) => { event.preventDefault(); openMenu(event.clientX, event.clientY); } : undefined}
      onKeyDown={canDiscard ? (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom);
        }
      } : undefined}>
      {menu && createPortal(
        <div ref={menuRef} role="menu" aria-label={`Actions for ${path}`} className="worktree-context-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y, width: 210, maxWidth: "100vw", zIndex: 2000 }}>
          <button type="button" role="menuitem" className="worktree-context-menu-item" disabled={busy}
            onClick={() => { setMenu(null); row.current?.querySelector<HTMLButtonElement>("button")?.focus(); onDiscard(path); }}>
            Discard changes to {path}
          </button>
        </div>, document.body,
      )}
      <input
          type="checkbox"
          className="source-control-file-select"
          aria-label={`Select ${path}`}
          checked={selectedForBatch}
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectForBatch(path, staged, (event.nativeEvent as MouseEvent).shiftKey, isConflict)}
        />
      <button
        type="button"
        className="source-control-file-main"
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            onSelectForBatch(path, staged, true, isConflict);
            return;
          }
          onShowDiff(path, staged);
        }}
      >
        <span className="source-control-file-name" title={path}>
          {fileLabel(path)}
        </span>
        <span
          className={`source-control-file-code${isConflict ? " conflict" : ""}`}
          title={isConflict ? "Conflicted (unmerged)" : entry ? (statusCode(entry) === "M" ? "Modified" : statusCode(entry) === "A" ? "Added" : statusCode(entry) === "D" ? "Deleted" : statusCode(entry) === "R" ? "Renamed" : statusCode(entry)) : "Untracked"}
        >
          {isConflict ? "U" : entry ? statusCode(entry) : "?"}
        </span>
      </button>
      <div className="source-control-file-actions">
        {!isConflict && (
          <span className="source-control-action-hint" title={entry || staged ? "Tracked files cannot be ignored; no files will be untracked" : "Add literal path to .gitignore"}>
            <button type="button" className="source-control-stage-btn" disabled={busy || !!entry || staged}
              aria-label={`Ignore ${path}`} onClick={() => onIgnore(path)}><EyeOff size={14} /></button>
          </span>
        )}
        {!isConflict && (
          <span className="source-control-action-hint" title={busy ? `${staged ? "Unstage" : "Stage"} unavailable while an operation is in progress` : staged ? "Unstage" : "Stage"}>
            <button type="button" className="source-control-stage-btn" disabled={busy}
              aria-label={staged ? "Unstage" : "Stage"} onClick={() => onToggleStaged(path, staged)}>
              {staged ? <Minus size={14} /> : <Plus size={14} />}
            </button>
          </span>
        )}
        {isConflict && (
          <>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => onResolveConflict(path, "ours")}
              title="Accept our version"
            >
              ours
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => onResolveConflict(path, "theirs")}
              title="Accept their version"
            >
              theirs
            </button>
          </>
        )}

      </div>
    </div>
  );
}

export function SourceControlDialog({
  dir,
  onClose,
}: {
  dir: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const { openSettings } = useSettingsModal();
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<(GraphCommit & { message: string }) | null>(null);
  const [terminalError, setTerminalError] = useState("");
  const terminals = useSourceControlTerminals(dir, onClose, setTerminalError);
  // Full-page (default) or a floating, draggable and resizable window. The
  // choice persists; it is ignored when the app window is too narrow for a
  // floating panel to be usable, which falls back to the tabbed full page.
  const [floating, setFloating] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hermes.sourceControl.floating") === "1";
    } catch {
      return false;
    }
  });
  const [viewportWide, setViewportWide] = useState(
    () => !isNarrowSourceControl(window.innerWidth),
  );
  useEffect(() => {
    const onResize = (): void =>
      setViewportWide(!isNarrowSourceControl(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const useFloating = floating && viewportWide;
  useEffect(() => {
    // The dock subtree remounts with the wrapper; re-attach the running ptys so
    // the terminal pane is not empty after floating/docking.
    terminals.reattach();
  }, [terminals.reattach, useFloating]);
  const toggleFloating = useCallback((): void => {
    setFloating((current) => {
      const next = !current;
      try {
        localStorage.setItem("hermes.sourceControl.floating", next ? "1" : "0");
      } catch {
        // Storage unavailable: the toggle still works for this mount.
      }
      return next;
    });
  }, []);
  // Narrow panel (small floating window or narrow app window): the diff split
  // cannot show both panes side by side, so they become tabs.
  const [narrow, setNarrow] = useState(() =>
    isNarrowSourceControl(window.innerWidth),
  );
  // A callback ref (not an effect) because the root remounts when the panel
  // moves between full-page and floating, and again when loading finishes.
  const dialogObserver = useRef<ResizeObserver | null>(null);
  const setDialogNode = useCallback((node: HTMLDivElement | null): void => {
    dialogObserver.current?.disconnect();
    dialogObserver.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setNarrow(isNarrowSourceControl(width));
    });
    observer.observe(node);
    dialogObserver.current = observer;
  }, []);
  const [narrowPane, setNarrowPane] = useState<"changes" | "diff">("changes");
  const [narrowGraphPane, setNarrowGraphPane] = useState<"list" | "diff">("list");
  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      // Escape belongs to the shell/application when focus is inside its terminal.
      if (event.key === "Escape" && !document.querySelector("dialog.app-confirm[open]") && !branchesOpen && !renameTarget && !(event.target instanceof Element && event.target.closest(".source-control-terminals"))) void terminals.requestClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [terminals.requestClose, branchesOpen, renameTarget]);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const actionInFlight = useRef(false);
  const [selected, setSelected] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  // Ordered list: selection order is preserved for deterministic batch actions.
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const selectionAnchorRef = useRef<{ path: string; group: "staged" | "changes" | "conflicts" } | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [stashRevision, setStashRevision] = useState(0);
  const [stashPreview, setStashPreview] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [output, setOutput] = useState<string>("");
  const [outputHeight, setOutputHeight] = useState(120);
  const [outputMaxHeight, setOutputMaxHeight] = useState(() => Math.max(80, Math.min(400, Math.floor(window.innerHeight * 0.4))));
  const outputDrag = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    const resize = () => {
      const max = Math.max(80, Math.min(400, Math.floor(window.innerHeight * 0.4)));
      setOutputMaxHeight(max);
      setOutputHeight((height) => Math.min(height, max));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [error, setError] = useState<string>("");
  const [remoteHost, setRemoteHost] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  // Tab view: the classic working-tree change list, or the commit graph.
  const [view, setView] = useState<"changes" | "graph" | "docs">("changes");
  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<GraphCommit | null>(
    null,
  );
  const [commitDiff, setCommitDiff] = useState("");
  const graphLoadedRef = useRef(false);

  // Load the remote host + any stored token for it (token auth on new PCs).
  useEffect(() => {
    void (async () => {
      const host = await window.hermesAPI.gitRemoteHost(dir);
      setRemoteHost(host);
      if (host && host.toLowerCase() !== "github.com") {
        const stored = await window.hermesAPI.gitGetToken(host);
        if (stored) {
          setToken(stored);
          setTokenSaved(true);
        }
      }
    })();
  }, [dir]);

  const saveToken = useCallback(async (): Promise<void> => {
    if (!remoteHost) return;
    await window.hermesAPI.gitSetToken(remoteHost, token.trim());
    setTokenSaved(Boolean(token.trim()));
  }, [remoteHost, token]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStashRevision((value) => value + 1);
      const next = await window.hermesAPI.gitRepoStatus(dir);
      setStatus(next);
      const selectable = new Set([
        ...next.staged.map((file) => `staged:${file.path}`),
        ...next.unstaged.map((file) => `changes:${file.path}`),
        ...next.untracked.map((path) => `changes:${path}`),
        ...next.conflicted.map((file) => `conflicts:${file.path}`),
      ]);
      setBatchSelection((previous) => previous.filter((key) => selectable.has(key)));
      if (selectionAnchorRef.current && !selectable.has(`${selectionAnchorRef.current.group}:${selectionAnchorRef.current.path}`)) {
        selectionAnchorRef.current = null;
      }
      setSelected((prev) => {
        if (!prev) return prev;
        const still =
          next.staged.some((f) => f.path === prev.path) ||
          next.unstaged.some((f) => f.path === prev.path) ||
          next.conflicted.some((f) => f.path === prev.path) ||
          next.untracked.includes(prev.path);
        return still ? prev : null;
      });
    } finally {
      setRefreshing(false);
    }
  }, [dir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showDiff = useCallback(
    async (path: string, staged: boolean) => {
      setStashPreview(null);
      setSelected({ path, staged });
      const res = await window.hermesAPI.gitDiff(dir, path, staged);
      setDiff(res.ok ? (res.output ?? "") : (res.error ?? ""));
    },
    [dir],
  );

  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const historyFilter = useRef<{ from?: string; to?: string }>({});
  const loadGraph = useCallback(
    async () => {
      setGraphLoading(true);
      setGraphError("");
      try {
        const res = await window.hermesAPI.gitLog(dir, { max: 50, ...historyFilter.current });
        setCommits(res.ok ? res.commits : []);
        if (!res.ok) setGraphError(res.error ?? "History unavailable");
      } catch (err) {
        setGraphError(String(err));
        setCommits([]);
      } finally {
        setGraphLoading(false);
      }
    },
    [dir],
  );

  // Load the history lazily: only when the graph tab is first opened, so a huge
  // repo's log never delays the dialog's initial paint.
  useEffect(() => {
    if (view !== "graph" || graphLoadedRef.current) return;
    graphLoadedRef.current = true;
    void loadGraph();
  }, [view, loadGraph]);

  const checkRename = useCallback((hash: string) => window.hermesAPI.gitRenameCheck(dir, hash), [dir]);

  const showCommit = useCallback(
    async (commit: GraphCommit) => {
      setSelectedCommit(commit);
      setCommitDiff("");
      try {
        const res = await window.hermesAPI.gitCommitDiff(dir, commit.hash);
        setCommitDiff(res.ok ? (res.output ?? "") : (res.error ?? ""));
      } catch {
        setCommitDiff("");
      }
    },
    [dir],
  );

  const run = useCallback(
    async (fn: () => Promise<GitActionResult>, label: string) => {
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      setBusy(true);
      setError("");
      setOutput("");
      try {
        const res = await fn();
        if (res.ok) {
          setOutput(res.output ?? label);
        } else {
          // Network ops run git in the background with GIT_TERMINAL_PROMPT=0:
          // Git Credential Manager opens its own login window, but if it's
          // not installed the push can't authenticate — tell the user how.
          const errText = res.error ?? `${label} failed`;
          if (
            /could not read Username|authentication failed|terminal prompts disabled|401|403|403 forbidden|not authorized/i.test(
              errText,
            )
          ) {
            setError(
              `${errText}\n\nGit couldn't authenticate. If Git Credential Manager didn't open a login window, run once in a terminal: git push — it will prompt you to sign in (or set up an SSH key for the remote).`,
            );
          } else {
            setError(errText);
          }
        }
      } catch (err) {
        setError(String(err));
      } finally {
        try {
          await refresh();
        } catch (err) {
          setError(String(err));
        } finally {
          actionInFlight.current = false;
          setBusy(false);
        }
      }
    },
    [refresh],
  );

  const toggleStaged = useCallback(
    async (path: string, staged: boolean) => {
      if (staged) {
        await run(() => window.hermesAPI.gitUnstage(dir, [path]), "Unstaged");
      } else {
        await run(() => window.hermesAPI.gitStage(dir, [path]), "Staged");
      }
    },
    [dir, run],
  );

  const sectionPaths = useMemo(() => ({
    staged: status?.staged.map((file) => file.path) ?? [],
    changes: [...(status?.unstaged.map((file) => file.path) ?? []), ...(status?.untracked ?? [])],
    conflicts: status?.conflicted.map((file) => file.path) ?? [],
  }), [status]);
  const selectForBatch = useCallback((path: string, staged: boolean, shift: boolean, isConflict = false) => {
    if (busy || refreshing) return;
    const section = isConflict ? "conflicts" : staged ? "staged" : "changes";
    const group = sectionPaths[section];
    const key = `${section}:${path}`;
    const anchor = selectionAnchorRef.current;
    const canRange = shift && anchor?.group === section;
    const anchorIndex = canRange ? group.indexOf(anchor.path) : -1;
    const targetIndex = group.indexOf(path);
    setBatchSelection((previous) => {
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const range = group.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
          .map((item) => `${section}:${item}`);
        return [...previous.filter((item) => !range.includes(item)), ...range];
      }
      return previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key];
    });
    if (!shift || anchorIndex < 0) selectionAnchorRef.current = { path, group: section };
  }, [sectionPaths, busy, refreshing]);
  const allSelected = (group: keyof typeof sectionPaths): boolean =>
    sectionPaths[group].length > 0 && sectionPaths[group].every((path) => batchSelection.includes(`${group}:${path}`));
  const toggleAll = (group: keyof typeof sectionPaths): void => {
    if (busy || refreshing) return;
    const keys = sectionPaths[group].map((path) => `${group}:${path}`);
    setBatchSelection((previous) => keys.every((key) => previous.includes(key))
      ? previous.filter((key) => !keys.includes(key))
      : [...previous, ...keys.filter((key) => !previous.includes(key))]);
    if (selectionAnchorRef.current?.group === group) selectionAnchorRef.current = null;
  };

  const selectedPaths = useCallback((staged: boolean): string[] =>
    batchSelection
      .filter((key) => key.startsWith(staged ? "staged:" : "changes:"))
      .map((key) => key.slice(key.indexOf(":") + 1)),
  [batchSelection]);

  /**
   * Only untracked paths can be ignored — git ignores nothing it already
   * tracks. A range selection usually mixes modified (tracked) and untracked
   * rows, so the batch must act on the untracked part instead of refusing
   * everything.
   */
  const ignorablePaths = useCallback((): string[] => {
    const untracked = new Set(status?.untracked ?? []);
    return selectedPaths(false).filter((path) => untracked.has(path));
  }, [selectedPaths, status]);

  const stashSelected = async (staged: boolean): Promise<void> => {
    const paths = selectedPaths(staged);
    if (!paths.length || !await appConfirm(`Stash selected ${paths.length} file(s)? Both staged and unstaged edits of these files will be saved and removed from the working tree. Selected untracked folders include their nonignored untracked contents. Untracked selected files are included; ignored files are not. Stashing source files of a running development app may trigger its watcher to reload or restart.`)) return;
    void run(() => window.hermesAPI.gitStashCreate(dir, paths), "Stashed selected");
  };

  const commit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return;
    await run(() => window.hermesAPI.gitCommit(dir, message), "Committed");
    setCommitMessage("");
  }, [commitMessage, dir, run]);

  const revertCommit = useCallback(
    async (target: import("./gitGraph").GraphCommit) => {
      if (
        !await appConfirm(
          `Revert commit ${target.shortHash} ("${target.subject}")?`,
        )
      ) {
        return;
      }
      await run(
        () => window.hermesAPI.gitRevert(dir, target.hash),
        `Reverted ${target.shortHash}`,
      );
      void loadGraph();
    },
    [dir, loadGraph, run],
  );

  const cancelRevert = useCallback(async () => {
    if (
      !await appConfirm(
        "Cancel in-progress revert? Uncommitted changes from this revert will be discarded.",
      )
    ) {
      return;
    }
    await run(() => window.hermesAPI.gitRevertAbort(dir), "Cancelled revert");
    void loadGraph();
  }, [dir, loadGraph, run]);

  const resolveConflict = useCallback(
    async (path: string, side: "ours" | "theirs") => {
      await run(
        () => window.hermesAPI.gitResolveConflict(dir, path, side),
        `Resolved ${fileLabel(path)} (${side})`,
      );
    },
    [dir, run],
  );

  const repoName = useMemo(
    () => dir.split(/[\\/]/).filter(Boolean).pop() || dir,
    [dir],
  );

  const stagedCount = status?.staged.length ?? 0;
  const changeCount =
    (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);

  // The handler bundle every FileRow needs. Applied once per row via spread so
  // the row stays a module-scope component with a stable identity.
  const fileRowHandlers = {
    busy: busy || refreshing,
    onIgnore: (path: string) => void run(() => window.hermesAPI.gitIgnoreAdd(dir, path), "Ignored"),
    onDiscard: async (path: string) => {
      if (await appConfirm(`Discard unstaged changes to ${path}? This cannot be undone.`)) {
        void run(async () => {
          const result = await window.hermesAPI.gitDiscard(dir, path);
          if (result.ok && selected?.path === path && !selected.staged) { setSelected(null); setDiff(""); }
          return result;
        }, "Discarded");
      }
    },
    onShowDiff: (path: string, staged: boolean) => void showDiff(path, staged),
    onSelectForBatch: (path: string, staged: boolean, shift: boolean, isConflict?: boolean) =>
      selectForBatch(path, staged, shift, isConflict),
    onToggleStaged: (path: string, staged: boolean) =>
      void toggleStaged(path, staged),
    onResolveConflict: (path: string, side: "ours" | "theirs") =>
      void resolveConflict(path, side),
  };

  // A full-page panel, not a modal: it fills the whole window and is portaled
  // to <body> so it escapes the FloatingDialog it is mounted inside (whose body
  // container clips and stacks it, which is what made the bottom look cropped
  // and double-chromed it with a second header). `onClose` is the way back.
  // (Shell/Section/FileRow are module-scope components — see the note on Shell.)

  if (!status) {
    return (
      <Shell>
        <div className="source-control-dialog">
          <div className="source-control-loading source-control-loading-state" role="status"><LoaderCircle size={24} aria-hidden="true" /><span>Loading repository…</span></div>
        </div>
      </Shell>
    );
  }

  if (!status.repo) {
    return (
      <Shell>
        <div className="source-control-dialog">
          <div className="source-control-header">
            <span className="file-changes-title">
              Source Control — {repoName}
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void terminals.requestClose()}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="source-control-not-repo">
            <span>Not a git repository</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || refreshing}
              onClick={async () => {
                if (await appConfirm(`Initialize a Git repository in "${dir}"? Creates local Git metadata only. No files will be staged or committed; no remote or push.`)) {
                  void run(() => window.hermesAPI.gitInit(dir), "Repository initialized");
                }
              }}>
              {busy ? <><LoaderCircle size={14} aria-hidden="true" />Initializing…</> : "Initialize repository"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || refreshing}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
          {error && <p className="source-control-empty" role="alert">{error}</p>}
        </div>
      </Shell>
    );
  }


  return (
    <Shell
      floating={useFloating}
      title={`Source Control — ${repoName}`}
      onClose={() => void terminals.requestClose()}
    >
      <div className="source-control-dialog" ref={setDialogNode}>
        <div className={`source-control-header${narrow ? " is-compact" : ""}`}>
          <span className="file-changes-title">
            Source Control — {repoName}
          </span>
          <button type="button" className="source-control-branch" title="Manage local branches" aria-label="Manage local branches" disabled={busy} onClick={() => setBranchesOpen(true)}>
            <GitBranch size={13} />
            <span className="source-control-branch-name">
              {status.branch ?? "(detached)"}
            </span>
            {status.upstream && (
              <span className="source-control-branch-track">
                {status.ahead > 0 ? `↑${status.ahead}` : ""}
                {status.behind > 0 ? `↓${status.behind}` : ""}

              </span>
            )}
          </button>
          <div className="source-control-header-actions">
            <div className="source-control-action-scroll">
            <button type="button" className="btn-ghost btn-sm source-control-terminal-toggle" aria-label="Terminal" aria-expanded={terminals.visible} aria-pressed={terminals.visible} title={terminals.visible ? "Hide terminal pane (sessions keep running)" : "Show terminal pane"} onClick={terminals.toggle}>
              Terminal
            </button>
            {remoteHost?.toLowerCase() === "github.com" && (
              <button type="button" className="btn-ghost btn-sm source-control-credentials" aria-label="Manage GitHub Credentials" title="Manage GitHub Credentials" onClick={() => { void terminals.requestClose().then((closed) => { if (closed) openSettings("github"); }); }}>
                Manage GitHub Credentials
              </button>
            )}

            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                void run(() => window.hermesAPI.gitFetch(dir), "Fetched")
              }
              title="Fetch"
              aria-label="Fetch"
            >
              Fetch
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                void run(() => window.hermesAPI.gitPull(dir), "Pulled")
              }
              title="Pull"
              aria-label="Pull"
            >
              Pull
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                void run(() => window.hermesAPI.gitPush(dir), "Pushed")
              }
              title="Push"
              aria-label="Push"
            >
              Push
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void refresh()}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            </div>
            <button
              type="button"
              className={`btn-ghost source-control-float-toggle${floating ? " is-active" : ""}`}
              aria-pressed={floating}
              disabled={!viewportWide && !floating}
              title={
                floating
                  ? "Dock as a full page"
                  : viewportWide
                    ? "Float in a resizable window"
                    : "Not enough room to float; widen the window"
              }
              aria-label={
                floating
                  ? "Dock source control as a full page"
                  : "Float source control in a window"
              }
              onClick={toggleFloating}
            >
              {floating ? <Maximize2 size={15} /> : <PictureInPicture2 size={15} />}
            </button>
            <button
              type="button"
              className="btn-ghost source-control-header-close"
              onClick={() => void terminals.requestClose()}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="source-control-tabbar">
          <button
            type="button"
            className={`source-control-tab${view === "changes" ? " active" : ""}`}
            onClick={() => setView("changes")}
          >
            <FileDiff size={13} />
            Changes
            {(stagedCount > 0 || changeCount > 0) && (
              <span className="source-control-tab-count">
                {stagedCount + changeCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`source-control-tab${view === "graph" ? " active" : ""}`}
            onClick={() => setView("graph")}
          >
            <GitCommitHorizontal size={13} />
            Graph
            {graphLoading && (
              <span className="source-control-tab-spinner" aria-hidden />
            )}
          </button>
          <button type="button" className={`source-control-tab${view === "docs" ? " active" : ""}`} onClick={() => setView("docs")}><BookOpen size={13} aria-hidden="true" />Git Doc</button>
        </div>

        {terminalError && <p role="alert">{terminalError}</p>}
        <SourceControlSplit className="source-control-workspace" label="Terminal pane width" initial={62} collapsed={!terminals.visible}>
        <div className="source-control-content">
        <div className={`source-control-body${narrow ? " is-narrow" : ""}`}>
          {view === "changes" ? (
            <>
            {narrow && (
              <div className="source-control-pane-tabs" role="tablist" aria-label="Changes layout">
                <button type="button" role="tab" aria-selected={narrowPane === "changes"}
                  className={`source-control-pane-tab${narrowPane === "changes" ? " active" : ""}`}
                  onClick={() => setNarrowPane("changes")}>Changes</button>
                <button type="button" role="tab" aria-selected={narrowPane === "diff"}
                  className={`source-control-pane-tab${narrowPane === "diff" ? " active" : ""}`}
                  onClick={() => setNarrowPane("diff")}>Diff</button>
              </div>
            )}
            <SourceControlSplit key="changes" label="Changes pane width" initial={35}
              className={narrow ? `source-control-split--narrow is-${narrowPane}` : ""}>
              <div className="source-control-sidebar">
                <div className="source-control-footer">
                  <textarea className="source-control-commit-input" aria-label="Commit message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={`Commit message (${shortcutLabel("gitCommit")} to commit)`} rows={2} onKeyDown={(event) => { if (matchesShortcut(event, "gitCommit") && !busy && stagedCount > 0) void commit(); }} />
                  <button type="button" className="source-control-commit-btn btn-sm" disabled={busy || !stagedCount || !commitMessage.trim()} onClick={() => void commit()}>Commit</button>
                </div>
                <Section title={`Conflicts (${status.conflicted.length})`}
                  selectionLabel="conflicts" allSelected={allSelected("conflicts")}
                  selectionDisabled={busy || refreshing || !status.conflicted.length} onToggleSelection={() => toggleAll("conflicts")}>
                  {status.conflicted.length === 0 ? (
                    <div className="source-control-empty">No conflicts</div>
                  ) : (
                    status.conflicted.map((f) => (
                      <FileRow
                        key={f.path}
                        path={f.path}
                        entry={f}
                        staged={false}
                        isConflict
                        {...fileRowHandlers}
                        selectedForBatch={batchSelection.includes(`conflicts:${f.path}`)}
                        active={
                          selected?.path === f.path && selected.staged === false
                        }
                      />
                    ))
                  )}
                </Section>
                <StashSection dir={dir} revision={stashRevision} busy={busy || refreshing} run={run}
                  onPreview={(raw, label) => { setSelected(null); setStashPreview(label); setDiff(raw); }} />
                <Section
                  title={`Staged (${stagedCount})`}
                  selectionLabel="staged" allSelected={allSelected("staged")}
                  selectionDisabled={busy || refreshing || !stagedCount} onToggleSelection={() => toggleAll("staged")}
                  toolbar={selectedPaths(true).length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void run(
                          () => window.hermesAPI.gitUnstage(dir, selectedPaths(true)),
                          "Unstaged selected",
                        )}
                      >
                        Unstage selected ({selectedPaths(true).length})
                      </button>
                      <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => stashSelected(true)}>Stash selected ({selectedPaths(true).length})</button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setBatchSelection([]);
                          selectionAnchorRef.current = null;
                        }}
                      >
                        Clear selection
                      </button>
                    </>
                  ) : undefined}
                >
                  {stagedCount === 0 ? (
                    <div className="source-control-empty">
                      No staged changes
                    </div>
                  ) : (
                    status.staged.map((f) => (
                      <FileRow
                        key={f.path}
                        path={f.path}
                        entry={f}
                        staged
                        {...fileRowHandlers}
                        selectedForBatch={batchSelection.includes(`staged:${f.path}`)}
                        active={
                          selected?.path === f.path && selected.staged === true
                        }
                      />
                    ))
                  )}
                </Section>
                <Section
                  title={`Changes (${changeCount})`}
                  selectionLabel="changes" allSelected={allSelected("changes")}
                  selectionDisabled={busy || refreshing || !changeCount} onToggleSelection={() => toggleAll("changes")}
                  toolbar={
                    selectedPaths(false).length > 0 ? (
                      <>
                        <button
                          type="button"
                          className="btn-ghost btn-sm source-control-stage-all"
                          disabled={busy}
                          onClick={() => void run(
                            () => window.hermesAPI.gitStage(dir, selectedPaths(false)),
                            "Staged selected",
                          )}
                        >
                          Stage selected ({selectedPaths(false).length})
                        </button>
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => stashSelected(false)}>Stash selected ({selectedPaths(false).length})</button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy || ignorablePaths().length === 0}
                          onClick={() => void run(
                            () => window.hermesAPI.gitIgnoreAddMany(dir, ignorablePaths()),
                            "Ignored selected",
                          )}
                          title={ignorablePaths().length === 0
                            ? "Only untracked files can be ignored. Tracked files must be removed from the index first."
                            : `Add ${ignorablePaths().length} untracked path${ignorablePaths().length === 1 ? "" : "s"} to the root .gitignore. Tracked files in the selection are skipped. No files are deleted.`}
                        >
                          Ignore selected ({ignorablePaths().length})
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setBatchSelection([]);
                            selectionAnchorRef.current = null;
                          }}
                        >
                          Clear selection
                        </button>
                      </>
                    ) : undefined
                  }
                  contextDisabled={busy || changeCount === 0}
                  contextAction={() => void run(
                    () => window.hermesAPI.gitStage(dir, [
                      ...status.unstaged.map((file) => file.path),
                      ...status.untracked,
                    ]), t("chat.sourceControl.stageAll"),
                  )}
                >
                  {status.unstaged.length === 0 &&
                  status.untracked.length === 0 ? (
                    <div className="source-control-empty">No changes</div>
                  ) : (
                    <>
                      {status.unstaged.map((f) => (
                        <FileRow
                          key={f.path}
                          path={f.path}
                          entry={f}
                          staged={false}
                          {...fileRowHandlers}
                          selectedForBatch={batchSelection.includes(`changes:${f.path}`)}
                          active={
                            selected?.path === f.path &&
                            selected.staged === false
                          }
                        />
                      ))}
                      {status.untracked.map((p) => (
                        <FileRow
                          key={p}
                          path={p}
                          staged={false}
                          {...fileRowHandlers}
                          selectedForBatch={batchSelection.includes(`changes:${p}`)}
                          active={
                            selected?.path === p && selected.staged === false
                          }
                        />
                      ))}
                    </>
                  )}
                </Section>
                <IgnoredFiles dir={dir} refresh={refresh} busy={busy || refreshing} />
              </div>
              <div className="source-control-diff">
                <DiffViewer
                  raw={diff}
                  path={stashPreview ?? selected?.path ?? null}
                  staged={stashPreview ? undefined : selected?.staged}
                />
              </div>
            </SourceControlSplit>
            </>
          ) : view === "graph" ? (
            <>
            {narrow && (
              <div className="source-control-pane-tabs" role="tablist" aria-label="History layout">
                <button type="button" role="tab" aria-selected={narrowGraphPane === "list"}
                  className={`source-control-pane-tab${narrowGraphPane === "list" ? " active" : ""}`}
                  onClick={() => setNarrowGraphPane("list")}>History</button>
                <button type="button" role="tab" aria-selected={narrowGraphPane === "diff"}
                  className={`source-control-pane-tab${narrowGraphPane === "diff" ? " active" : ""}`}
                  onClick={() => setNarrowGraphPane("diff")}>Commit</button>
              </div>
            )}
            <SourceControlSplit key="graph" label="Graph pane width" initial={46}
              className={narrow ? `source-control-split--narrow is-${narrowGraphPane}` : ""}>
              <div className="source-control-graph-list">
                {graphError && <p role="alert">{graphError}</p>}
                <form className="source-control-graph-toolbar source-control-graph-filters" onSubmit={(event) => {
                  event.preventDefault();
                  if (graphLoading) return;
                  if (historyFrom && historyTo && historyFrom > historyTo) {
                    setGraphError("From date must not exceed To date");
                    return;
                  }
                  historyFilter.current = { ...(historyFrom ? { from: historyFrom } : {}), ...(historyTo ? { to: historyTo } : {}) };
                  setSelectedCommit(null); setCommitDiff("");
                  void loadGraph();
                }}>
                  <label title="Filter by committer date; row dates show author dates">Start Date <input aria-label="History from" type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} /></label>
                  <label title="Inclusive committer date in UTC">End Date <input aria-label="History to" type="date" value={historyTo} min={historyFrom || undefined} onChange={(event) => setHistoryTo(event.target.value)} /></label>
                  <button type="submit" className="btn-ghost btn-sm" disabled={graphLoading}>Apply</button>
                </form>
                <div className="source-control-graph-toolbar">
                  <button type="button" className="btn-ghost btn-sm" disabled={graphLoading} onClick={() => { void loadGraph(); void refresh(); }}>Refresh history</button>
                  {status?.reverting && <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    title="Cancel in-progress revert"
                    onClick={() => void cancelRevert()}
                  >
                    Cancel revert
                  </button>}
                </div>
                {graphLoading && <p className="source-control-loading-state" role="status"><LoaderCircle size={16} aria-hidden="true" />Loading history…</p>}
                {!graphLoading && !graphError && <CommitGraph
                  commits={commits}
                  selectedHash={selectedCommit?.hash ?? null}
                  onSelect={(c) => void showCommit(c)}
                  onRevert={(c) => void revertCommit(c)}
                  onRename={(commit, message) => setRenameTarget({ ...commit, message })}
                  checkRename={checkRename}
                  busy={busy}
                />}
              </div>
              <div className="source-control-graph-diff">
                {selectedCommit ? (
                  <DiffViewer
                    raw={commitDiff}
                    path={`${selectedCommit.shortHash} ${selectedCommit.subject}`}
                  />
                ) : (
                  <div className="diff-viewer-empty">
                    Select a commit to see its changes
                  </div>
                )}
              </div>
            </SourceControlSplit>
            </>
          ) : <GitDoc />}
        </div>


        {remoteHost && remoteHost.toLowerCase() !== "github.com" && (
          <div className="source-control-token-row">
            <span className="source-control-token-label" title={remoteHost}>
              Token ({remoteHost})
            </span>
            <input
              type="password"
              className="source-control-token-input"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setTokenSaved(false);
              }}
              placeholder={
                tokenSaved
                  ? "Saved — change to replace"
                  : "Personal access token"
              }
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy || (!token.trim() && tokenSaved)}
              onClick={() => void saveToken()}
              title="Save token for this host (encrypted)"
            >
              {tokenSaved ? "Saved" : "Save token"}
            </button>
          </div>
        )}
        {renameTarget && <RenameCommitDialog initialMessage={renameTarget.message} hash={renameTarget.hash} onClose={() => setRenameTarget(null)} onRename={async (message) => {
          if (actionInFlight.current) throw new Error("Another Git operation is in progress");
          let failure = "";
          await run(async () => {
            const result = await window.hermesAPI.gitRenameCommit(dir, renameTarget.hash, message).catch((err) => ({ ok: false, error: String(err) }));
            if (!result.ok) failure = result.error ?? "Rename failed";
            else { setSelectedCommit(null); setCommitDiff(""); }
            return result;
          }, "Renamed commit");
          await loadGraph();
          if (failure) throw new Error(failure);
        }} />}
        {branchesOpen && <BranchDialog dir={dir} onClose={() => setBranchesOpen(false)} onChanged={async (result) => {
          setOutput(result.ok ? result.output ?? "Branch updated" : "");
          setError(result.ok ? "" : result.error ?? "Branch operation failed");
          setSelected(null); setDiff(""); setSelectedCommit(null); setCommitDiff("");
          await refresh();
          if (graphLoadedRef.current) await loadGraph();
        }} />}
        {(output || error) && (
          <section className="source-control-output-panel" aria-label="Git output">
            <div
              className="source-control-output-divider"
              role="separator"
              tabIndex={0}
              aria-label="Output height"
              aria-orientation="horizontal"
              aria-valuemin={80}
              aria-valuemax={outputMaxHeight}
              aria-valuenow={outputHeight}
              onKeyDown={(event) => {
                if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                setOutputHeight((height) => event.key === "Home" ? 80 : event.key === "End" ? outputMaxHeight
                  : Math.max(80, Math.min(outputMaxHeight, height + (event.key === "ArrowUp" ? 10 : -10))));
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const output = event.currentTarget.parentElement?.querySelector(".source-control-output");
                outputDrag.current = { y: event.clientY, height: output?.getBoundingClientRect().height || outputHeight };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!outputDrag.current) return;
                setOutputHeight(Math.max(80, Math.min(outputMaxHeight, outputDrag.current.height + outputDrag.current.y - event.clientY)));
              }}
              onPointerUp={() => { outputDrag.current = null; }}
              onPointerCancel={() => { outputDrag.current = null; }}
              onLostPointerCapture={() => { outputDrag.current = null; }}
            />
            <div className="source-control-output-header">
              <span>Output</span>
              <button type="button" className="btn-ghost btn-sm" aria-label="Close Git output" title="Close output" onClick={() => { setOutput(""); setError(""); outputDrag.current = null; }}><X size={14} aria-hidden="true" /></button>
            </div>
            <div className={`source-control-output${error ? " error" : ""}`} style={{ height: outputHeight }} tabIndex={0} role={error ? "alert" : "status"}>
              {error || output}
            </div>
          </section>
        )}
        </div>
        <aside className="source-control-terminals" aria-label="Source Control terminals" hidden={!terminals.visible}>
          {terminals.mounted && <TerminalDock ref={terminals.dock} onNewSession={terminals.add} onSessionClose={terminals.closed} disposeOnUnmount
            onResizeStart={() => undefined} onResizeMove={() => undefined} onResizeEnd={() => undefined} />}
        </aside>
        </SourceControlSplit>
      </div>
    </Shell>
  );
}
