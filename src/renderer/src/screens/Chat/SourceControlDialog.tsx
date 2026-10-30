import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import { DiffViewer } from "./DiffViewer";
import { CommitGraph } from "./CommitGraph";
import { IgnoredFiles } from "./IgnoredFiles";
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
function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return createPortal(
    <div className="source-control-page">{children}</div>,
    document.body,
  );
}

function Section({ title, toolbar, children, contextAction, contextDisabled = false }: {
  title: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  contextAction?: () => void;
  contextDisabled?: boolean;
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
      {toolbar && <div className="source-control-section-toolbar">{toolbar}</div>}
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
  onSelectForBatch: (path: string, staged: boolean, shift: boolean) => void;
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
      {!isConflict && (
        <input
          type="checkbox"
          className="source-control-file-select"
          aria-label={`Select ${path}`}
          checked={selectedForBatch}
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectForBatch(path, staged, (event.nativeEvent as MouseEvent).shiftKey)}
        />
      )}
      <button
        type="button"
        className="source-control-file-main"
        onClick={(event) => {
          if (event.shiftKey && !isConflict) {
            event.preventDefault();
            onSelectForBatch(path, staged, true);
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
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const [selected, setSelected] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  // Ordered list: selection order is preserved for deterministic batch actions.
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const selectionAnchorRef = useRef<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<string>("");
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
  const [view, setView] = useState<"changes" | "graph">("changes");
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
    const next = await window.hermesAPI.gitRepoStatus(dir);
    setStatus(next);
    const selectable = new Set([
      ...next.staged.map((file) => `staged:${file.path}`),
      ...next.unstaged.map((file) => `changes:${file.path}`),
      ...next.untracked.map((path) => `changes:${path}`),
    ]);
    setBatchSelection((previous) => previous.filter((key) => selectable.has(key)));
    if (selectionAnchorRef.current && !selectable.has(`${selectionAnchorRef.current.staged ? "staged" : "changes"}:${selectionAnchorRef.current.path}`)) {
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
  }, [dir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showDiff = useCallback(
    async (path: string, staged: boolean) => {
      setSelected({ path, staged });
      const res = await window.hermesAPI.gitDiff(dir, path, staged);
      setDiff(res.ok ? (res.output ?? "") : (res.error ?? ""));
    },
    [dir],
  );

  const loadGraph = useCallback(
    async (max = 60) => {
      setGraphLoading(true);
      setGraphError("");
      try {
        const res = await window.hermesAPI.gitLog(dir, { max });
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

  const selectForBatch = useCallback((path: string, staged: boolean, shift: boolean) => {
    const group = staged
      ? (status?.staged.map((file) => file.path) ?? [])
      : [
          ...(status?.unstaged.map((file) => file.path) ?? []),
          ...(status?.untracked ?? []),
        ];
    const key = `${staged ? "staged" : "changes"}:${path}`;
    const anchor = selectionAnchorRef.current;
    const canRange = shift && anchor?.staged === staged;
    const anchorIndex = canRange ? group.indexOf(anchor.path) : -1;
    const targetIndex = group.indexOf(path);
    setBatchSelection((previous) => {
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const range = group.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
          .map((item) => `${staged ? "staged" : "changes"}:${item}`);
        return [...previous.filter((item) => !range.includes(item)), ...range];
      }
      return previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key];
    });
    if (!shift || anchorIndex < 0) selectionAnchorRef.current = { path, staged };
  }, [status]);

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

  const commit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return;
    await run(() => window.hermesAPI.gitCommit(dir, message), "Committed");
    setCommitMessage("");
  }, [commitMessage, dir, run]);

  const revertCommit = useCallback(
    async (target: import("./gitGraph").GraphCommit) => {
      if (
        !window.confirm(
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
      !window.confirm(
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
    busy,
    onIgnore: (path: string) => void run(() => window.hermesAPI.gitIgnoreAdd(dir, path), "Ignored"),
    onDiscard: (path: string) => {
      if (window.confirm(`Discard unstaged changes to ${path}? This cannot be undone.`)) {
        void run(async () => {
          const result = await window.hermesAPI.gitDiscard(dir, path);
          if (result.ok && selected?.path === path && !selected.staged) { setSelected(null); setDiff(""); }
          return result;
        }, "Discarded");
      }
    },
    onShowDiff: (path: string, staged: boolean) => void showDiff(path, staged),
    onSelectForBatch: (path: string, staged: boolean, shift: boolean) =>
      selectForBatch(path, staged, shift),
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
          <div className="source-control-loading">{t("worktree.loading")}…</div>
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
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="source-control-not-repo">
            Not a git repository
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        </div>
      </Shell>
    );
  }


  return (
    <Shell>
      <div className="source-control-dialog">
        <div className="source-control-header">
          <span className="file-changes-title">
            Source Control — {repoName}
          </span>
          <span className="source-control-branch" title={dir}>
            <GitBranch size={13} />
            {status.branch ?? "(detached)"}
            {status.upstream && (
              <span className="source-control-branch-track">
                {status.ahead > 0 ? `↑${status.ahead}` : ""}
                {status.behind > 0 ? `↓${status.behind}` : ""}

              </span>
            )}
          </span>
          <div className="source-control-header-actions">
            {remoteHost?.toLowerCase() === "github.com" && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => { onClose(); openSettings("github"); }}>
                Manage GitHub credentials
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
            >
              Push
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void refresh()}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
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
        </div>

        <div className="source-control-body">
          {view === "changes" ? (
            <>
              <div className="source-control-sidebar">
                <div className="source-control-footer">
                  <textarea className="source-control-commit-input" aria-label="Commit message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message (Ctrl+Enter to commit)" rows={2} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !busy && stagedCount > 0) void commit(); }} />
                  <button type="button" className="source-control-commit-btn btn-sm" disabled={busy || !stagedCount || !commitMessage.trim()} onClick={() => void commit()}>Commit</button>
                </div>
                <Section title={`Conflicts (${status.conflicted.length})`}>
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
                        selectedForBatch={false}
                        active={
                          selected?.path === f.path && selected.staged === false
                        }
                      />
                    ))
                  )}
                </Section>
                <Section
                  title={`Staged (${stagedCount})`}
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
                <IgnoredFiles dir={dir} refresh={refresh} />
              </div>
              <div className="source-control-diff">
                <DiffViewer
                  raw={diff}
                  path={selected?.path ?? null}
                  staged={selected?.staged}
                />
              </div>
            </>
          ) : (
            <div className="source-control-graph-pane">
              <div className="source-control-graph-list">
                {graphError && <p role="alert">{graphError}</p>}
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
            </div>
          )}
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

            </div>
            <div className={`source-control-output${error ? " error" : ""}`} style={{ height: outputHeight }} tabIndex={0} role={error ? "alert" : "status"}>
              {error || output}
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
