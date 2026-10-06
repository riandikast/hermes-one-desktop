import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  GitPullRequest,
  GitBranch,
  RefreshCw,
  GitCommitHorizontal,
  FileDiff,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { DiffViewer } from "./DiffViewer";
import { CommitGraph } from "./CommitGraph";
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="source-control-section">
      <div className="source-control-section-title">{title}</div>
      {children}
    </div>
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
  busy,
  onShowDiff,
  onToggleStaged,
  onResolveConflict,
}: {
  path: string;
  entry?: { index: string; worktree: string };
  staged: boolean;
  isConflict?: boolean;
  active: boolean;
  busy: boolean;
  onShowDiff: (path: string, staged: boolean) => void;
  onToggleStaged: (path: string, staged: boolean) => void;
  onResolveConflict: (path: string, side: "ours" | "theirs") => void;
}): React.JSX.Element {
  return (
    <div className={`source-control-file${active ? " active" : ""}`}>
      <button
        type="button"
        className="source-control-file-main"
        onClick={() => onShowDiff(path, staged)}
      >
        <span
          className={`source-control-file-code ${isConflict ? "conflict" : ""}`}
        >
          {isConflict ? "U" : entry ? statusCode(entry) : "?"}
        </span>
        <span className="source-control-file-name" title={path}>
          {fileLabel(path)}
        </span>
      </button>
      <div className="source-control-file-actions">
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
        {!isConflict && (
          <button
            type="button"
            className="source-control-stage-btn"
            disabled={busy}
            onClick={() => onToggleStaged(path, staged)}
            title={staged ? "Unstage" : "Stage"}
          >
            {staged ? "Unstage" : "+"}
          </button>
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
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState("");
  const [output, setOutput] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [remoteHost, setRemoteHost] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  // Tab view: the classic working-tree change list, or the commit graph.
  const [view, setView] = useState<"changes" | "graph">("changes");
  const [commits, setCommits] = useState<GraphCommit[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
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
      if (host) {
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
      try {
        const res = await window.hermesAPI.gitLog(dir, { max });
        setCommits(res.ok ? res.commits : []);
      } catch {
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
        setBusy(false);
        await refresh();
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

  const commit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return;
    await run(() => window.hermesAPI.gitCommit(dir, message), "Committed");
    setCommitMessage("");
  }, [commitMessage, dir, run]);

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
    onShowDiff: (path: string, staged: boolean) => void showDiff(path, staged),
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
                {status.ahead === 0 && status.behind === 0 ? "✓" : ""}
              </span>
            )}
          </span>
          <div className="source-control-header-actions">
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
              <GitPullRequest size={14} /> Pull
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
                        active={
                          selected?.path === f.path && selected.staged === false
                        }
                      />
                    ))
                  )}
                </Section>
                <Section title={`Staged (${stagedCount})`}>
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
                        active={
                          selected?.path === f.path && selected.staged === true
                        }
                      />
                    ))
                  )}
                </Section>
                <Section
                  title={`Changes (${(status.unstaged.length ?? 0) + (status.untracked.length ?? 0)})`}
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
                          active={
                            selected?.path === p && selected.staged === false
                          }
                        />
                      ))}
                    </>
                  )}
                </Section>
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
                <CommitGraph
                  commits={commits}
                  selectedHash={selectedCommit?.hash ?? null}
                  onSelect={(c) => void showCommit(c)}
                />
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

        {view === "changes" && (
          <div className="source-control-footer">
            <textarea
              className="source-control-commit-input"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={`Commit message (${stagedCount} file${stagedCount === 1 ? "" : "s"} staged)`}
              rows={2}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  void commit();
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || stagedCount === 0 || !commitMessage.trim()}
              onClick={() => void commit()}
            >
              Commit
            </button>
          </div>
        )}
        {remoteHost && (
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
          <div className={`source-control-output${error ? " error" : ""}`}>
            {error || output}
          </div>
        )}
      </div>
    </Shell>
  );
}
