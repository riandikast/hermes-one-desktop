import { forwardRef, useImperativeHandle, useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import { I18nProvider } from "../../components/I18nProvider";
import { SourceControlDialog, isNarrowSourceControl } from "./SourceControlDialog";
import sourceControlCss from "../../assets/main.css?raw";
import { SettingsModalContext } from "../../components/settings/SettingsModalContext";

vi.mock("../Command/TerminalDock", () => ({
  TerminalDock: forwardRef(function MockDock({ onNewSession, onSessionClose }: { onNewSession: () => void; onSessionClose: (id: string) => void }, ref) {
    const [ids, setIds] = useState<string[]>([]);
    useImperativeHandle(ref, () => ({ attachSession: (id: string) => setIds((current) => [...current, id]) }));
    return <div><button onClick={onNewSession}>New terminal session</button>{ids.map((id) => <button key={id} onClick={() => { setIds((current) => current.filter((item) => item !== id)); onSessionClose(id); }}>Close terminal {id}</button>)}</div>;
  }),
}));
const openSettings = vi.fn();

/** The dialog uses `t` from useI18n, which requires the provider. */
function renderDialog(
  dir: string,
  onClose: () => void = vi.fn(),
): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <SettingsModalContext.Provider value={{ openSettings, closeSettings: vi.fn() }}>
        <SourceControlDialog dir={dir} onClose={onClose} />
      </SettingsModalContext.Provider>
    </I18nProvider>,
  );
}

/**
 * These tests cover the wiring the pure modules can't: that the dialog asks for
 * history only when the Graph tab is opened, renders the commit rows, and swaps
 * in the changed-file diff viewer on the Changes tab. The lane maths itself is
 * in gitGraph.test.ts and the tokenizer in diffHighlight.test.ts.
 */

const commit = (
  hash: string,
  parents: string[],
  subject: string,
): {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  subject: string;
} => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents,
  refs: [],
  author: "tester",
  date: "2026-01-01T00:00:00Z",
  subject,
});

const gitLog = vi.fn();
const gitRepoStatus = vi.fn();
const gitDiff = vi.fn();
const gitCommitDiff = vi.fn();
const gitRevert = vi.fn();
const gitRevertAbort = vi.fn();

beforeEach(() => {
  localStorage.removeItem("hermes.sourceControl.floating");
  gitLog.mockReset();
  gitRepoStatus.mockReset();
  gitDiff.mockReset();
  gitCommitDiff.mockReset();
  gitRevert.mockReset().mockResolvedValue({ ok: true, output: "Revert succeeded" });
  gitRevertAbort.mockReset().mockResolvedValue({ ok: true, output: "Revert aborted" });

  gitRepoStatus.mockResolvedValue({
    repo: true,
    root: "/repo",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    conflicted: [],
    staged: [],
    unstaged: [{ index: " ", worktree: "M", path: "a.ts" }],
    untracked: [],
  });
  gitDiff.mockResolvedValue({ ok: true, output: "" });
  gitCommitDiff.mockResolvedValue({ ok: true, output: "" });

  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    gitRepoStatus,
    gitInit: vi.fn().mockResolvedValue({ ok: true }),
    gitStashList: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
    gitStashFiles: vi.fn().mockResolvedValue({ ok: true, files: [] }),
    gitStashFileDiff: vi.fn().mockResolvedValue({ ok: true, output: "" }),
    gitStashRestoreFiles: vi.fn().mockResolvedValue({ ok: true }),
    gitStashDeleteFiles: vi.fn().mockResolvedValue({ ok: true }),
    gitStashCreate: vi.fn().mockResolvedValue({ ok: true }),
    gitStashApply: vi.fn().mockResolvedValue({ ok: true }),
    gitStashDrop: vi.fn().mockResolvedValue({ ok: true }),
    gitStashDiff: vi.fn().mockResolvedValue({ ok: true, output: "" }),
    gitLog,
    gitDiff,
    gitCommitDiff,
    gitRemoteHost: vi.fn().mockResolvedValue(null),
    gitGetToken: vi.fn().mockResolvedValue(null),
    gitSetToken: vi.fn().mockResolvedValue(true),
    gitStage: vi.fn().mockResolvedValue({ ok: true }),
    gitDiscard: vi.fn().mockResolvedValue({ ok: true }),
    gitIgnoreAdd: vi.fn().mockResolvedValue({ ok: true }),
    gitIgnoreAddMany: vi.fn().mockResolvedValue({ ok: true }),
    gitUnstage: vi.fn().mockResolvedValue({ ok: true }),
    gitCommit: vi.fn().mockResolvedValue({ ok: true }),
    gitPull: vi.fn().mockResolvedValue({ ok: true }),
    gitPush: vi.fn().mockResolvedValue({ ok: true }),
    gitFetch: vi.fn().mockResolvedValue({ ok: true }),
    gitResolveConflict: vi.fn().mockResolvedValue({ ok: true }),
    gitRevert,
    gitRevertAbort,
    gitRenameCheck: vi.fn().mockResolvedValue({ ok: false, error: "published" }),
    gitRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
    terminalCreate: vi.fn().mockResolvedValue({ id: "source-term", shell: "pwsh" }),
    terminalKill: vi.fn().mockResolvedValue({ ok: true }),
  };
});

describe("SourceControlDialog", () => {
  it("confirms initialization of non-repository folders and refreshes into Source Control", async () => {
    const ready = await gitRepoStatus();
    gitRepoStatus.mockResolvedValue({ ...ready, repo: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog("/repo");
    const initialize = await screen.findByRole("button", { name: "Initialize repository" });
    fireEvent.click(initialize);
    expect(window.hermesAPI.gitInit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    let finish!: (result: { ok: boolean }) => void;
    vi.mocked(window.hermesAPI.gitInit).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(initialize);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('"/repo"'));
    expect(await screen.findByRole("button", { name: "Initializing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    gitRepoStatus.mockResolvedValue(ready);
    await act(async () => finish({ ok: true }));
    expect(await screen.findByRole("button", { name: "Manage local branches" })).toBeTruthy();
    expect(window.hermesAPI.gitInit).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.gitStage).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("shows initialization failure and allows retry without closing", async () => {
    const ready = await gitRepoStatus();
    gitRepoStatus.mockResolvedValue({ ...ready, repo: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(window.hermesAPI.gitInit).mockResolvedValue({ ok: false, error: "Permission denied" });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Initialize repository" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
    expect(screen.getByRole("button", { name: "Initialize repository" })).toBeEnabled();
  });
  it("toggles each file section independently, appending missing paths in display order without running Git", async () => {
    const initial = await gitRepoStatus();
    gitRepoStatus.mockResolvedValue({ ...initial,
      staged: ["s1.ts", "s2.ts", "s3.ts"].map((path) => ({ index: "M", worktree: " ", path })),
      unstaged: ["a.ts", "b.ts"].map((path) => ({ index: " ", worktree: "M", path })),
      untracked: ["new folder/"],
      conflicted: ["x.ts", "y.ts"].map((path) => ({ index: "U", worktree: "U", path })),
    });
    renderDialog("/repo");
    fireEvent.click(await screen.findByLabelText("Select s3.ts"));
    fireEvent.click(screen.getByLabelText("Select new folder/"));
    for (const section of ["staged", "changes", "conflicts"]) {
      const toggle = screen.getByRole("button", { name: `Select all ${section}` });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle.closest("summary")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle).toHaveAccessibleName(`Unselect all ${section}`);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle.closest("details")).toHaveAttribute("open");
    }
    for (const path of ["s1.ts", "s2.ts", "s3.ts", "a.ts", "b.ts", "new folder/", "x.ts", "y.ts"]) {
      expect(screen.getByLabelText(`Select ${path}`)).toBeChecked();
    }
    expect(window.hermesAPI.gitStage).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitUnstage).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitResolveConflict).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitStashCreate).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitIgnoreAddMany).not.toHaveBeenCalled();
    expect(gitDiff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unselect all conflicts" }));
    expect(screen.getByLabelText("Select x.ts")).not.toBeChecked();
    expect(screen.getByLabelText("Select new folder/")).toBeChecked();
    expect(screen.getByLabelText("Select s3.ts")).toBeChecked();
    await act(async () => screen.getByRole("button", { name: "Stage selected (3)" }).click());
    expect(window.hermesAPI.gitStage).toHaveBeenCalledWith("/repo", ["new folder/", "a.ts", "b.ts"]);
    await act(async () => screen.getByRole("button", { name: "Unstage selected (3)" }).click());
    expect(window.hermesAPI.gitUnstage).toHaveBeenCalledWith("/repo", ["s3.ts", "s1.ts", "s2.ts"]);
    fireEvent.click(screen.getByRole("button", { name: "Unselect all staged" }));
    expect(screen.getByLabelText("Select s3.ts")).not.toBeChecked();
    expect(screen.getByLabelText("Select new folder/")).toBeChecked();
  });
  it("resets bulk-selection anchors, supports conflict ranges, preserves conflict preview and resolution", async () => {
    const initial = await gitRepoStatus();
    const paths = ["x.ts", "y.ts", "z.ts"];
    gitRepoStatus.mockResolvedValue({ ...initial,
      conflicted: paths.map((path) => ({ index: "U", worktree: "U", path })),
    });
    renderDialog("/repo");
    fireEvent.click(await screen.findByLabelText("Select x.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Select all conflicts" }));
    fireEvent.click(screen.getByRole("button", { name: "Unselect all conflicts" }));
    fireEvent.click(screen.getByLabelText("Select z.ts"), { shiftKey: true });
    expect(screen.getByLabelText("Select x.ts")).not.toBeChecked();
    expect(screen.getByLabelText("Select y.ts")).not.toBeChecked();
    expect(screen.getByLabelText("Select z.ts")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "x.ts U" }), { shiftKey: true });
    for (const path of paths) expect(screen.getByLabelText(`Select ${path}`)).toBeChecked();
    expect(gitDiff).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitResolveConflict).not.toHaveBeenCalled();
    await act(async () => screen.getByRole("button", { name: "x.ts U" }).click());
    expect(gitDiff).toHaveBeenCalledWith("/repo", "x.ts", false);
    await act(async () => screen.getAllByRole("button", { name: "ours" })[0].click());
    expect(window.hermesAPI.gitResolveConflict).toHaveBeenCalledWith("/repo", "x.ts", "ours");
    await act(async () => screen.getAllByRole("button", { name: "theirs" })[1].click());
    expect(window.hermesAPI.gitResolveConflict).toHaveBeenCalledWith("/repo", "y.ts", "theirs");
    gitRepoStatus.mockResolvedValue({ ...initial, conflicted: [] });
    await act(async () => screen.getByTitle("Refresh").click());
    expect(screen.getByRole("button", { name: "Select all conflicts" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select all conflicts" })).toHaveAttribute("aria-pressed", "false");
  });
  it("disables empty, busy and refreshing selection toggles", async () => {
    renderDialog("/repo");
    const changes = await screen.findByRole("button", { name: "Select all changes" });
    expect(screen.getByRole("button", { name: "Select all staged" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select all conflicts" })).toBeDisabled();
    let finish!: (value: { ok: boolean }) => void;
    vi.mocked(window.hermesAPI.gitFetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(changes).toBeDisabled();
    fireEvent.click(changes);
    expect(screen.getByLabelText("Select a.ts")).not.toBeChecked();
    await act(async () => finish({ ok: true }));
    expect(changes).toBeEnabled();
    const initial = await gitRepoStatus();
    let finishRefresh!: (value: typeof initial) => void;
    gitRepoStatus.mockReturnValueOnce(new Promise((resolve) => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(changes).toBeDisabled();
    await act(async () => finishRefresh(initial));
    expect(changes).toBeEnabled();
  });
  it("places Stash above Staged and creates a stash from selected changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog("/repo");
    const stash = await screen.findByText("Stash (0)");
    const staged = screen.getByText("Staged (0)");
    expect(stash.compareDocumentPosition(staged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select a.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Stash selected (1)" }));
    await waitFor(() => expect(window.hermesAPI.gitStashCreate).toHaveBeenCalledWith("/repo", ["a.ts"]));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Both staged and unstaged"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Selected untracked folders include their nonignored untracked contents"));
    await waitFor(() => expect(window.hermesAPI.gitStashList).toHaveBeenCalledTimes(2));
    confirm.mockRestore();
  });
  it("reloads saved files after creating a stash without waiting for repository status", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog("/repo");
    await screen.findByText("No stashed files");
    const hash = "c".repeat(40);
    vi.mocked(window.hermesAPI.gitStashList).mockResolvedValue({ ok: true, entries: [{ hash, ref: "stash@{0}", subject: "saved" }] });
    vi.mocked(window.hermesAPI.gitStashFiles).mockResolvedValue({ ok: true, files: [{ path: "a.ts", status: "M" }] });
    let finish!: (value: unknown) => void;
    gitRepoStatus.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByLabelText("Select a.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Stash selected (1)" }));
    try { expect(await screen.findByLabelText("Select stash@{0}: a.ts")).toBeTruthy(); }
    finally { await act(async () => finish({ repo: true, staged: [], unstaged: [], conflicted: [], untracked: [] })); }
  });
  it("previews and restores individual saved files without applying the whole stash", async () => {
    const hash = "a".repeat(40);
    vi.mocked(window.hermesAPI.gitStashList).mockResolvedValue({ ok: true, entries: [{ hash, ref: "stash@{0}", subject: "On custom: Selected files" }] });
    vi.mocked(window.hermesAPI.gitStashFiles).mockResolvedValue({ ok: true, files: [{ path: "saved.ts", status: "M" }] });
    vi.mocked(window.hermesAPI.gitStashFileDiff).mockResolvedValue({ ok: true, output: "diff --git a/saved.ts b/saved.ts\n--- a/saved.ts\n+++ b/saved.ts\n@@ -1 +1 @@\n-old\n+saved content\n" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "saved.ts M" }));
    await waitFor(() => expect(document.querySelector(".diff-viewer-body")).toHaveTextContent("saved content"));
    expect(window.hermesAPI.gitStashFileDiff).toHaveBeenCalledWith("/repo", hash, "saved.ts");
    fireEvent.click(screen.getByRole("button", { name: "Restore stash@{0}: saved.ts" }));
    await waitFor(() => expect(window.hermesAPI.gitStashRestoreFiles).toHaveBeenCalledWith("/repo", [{ hash, paths: ["saved.ts"] }]));
    expect(window.hermesAPI.gitStashApply).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitStashDrop).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("can stash staged selections and cancellation never calls Git", async () => {
    const status = await window.hermesAPI.gitRepoStatus("/repo");
    gitRepoStatus.mockResolvedValue({ ...status, staged: [{ index: "M", worktree: " ", path: "staged.ts" }] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog("/repo");
    fireEvent.click(await screen.findByLabelText("Select staged.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Stash selected (1)" }));
    expect(window.hermesAPI.gitStashCreate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Stash selected (1)" }));
    await waitFor(() => expect(window.hermesAPI.gitStashCreate).toHaveBeenCalledWith("/repo", ["staged.ts"]));
    confirm.mockRestore();
  });
  it("shows animated repository loading instead of a translation key", async () => {
    let finish!: (value: unknown) => void;
    gitRepoStatus.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = renderDialog("/repo");
    const loading = screen.getByRole("status");
    expect(loading).toHaveTextContent("Loading repository");
    expect(loading.querySelector("svg.lucide-loader-circle")).not.toBeNull();
    view.unmount(); finish({ repo: false, staged: [], unstaged: [], conflicted: [], untracked: [] });
  });
  it("hides rename for published HEAD and reports the validation reason", async () => {
    const target = { ...commit("a".repeat(40), [], "local tip"), refs: ["HEAD -> main"] };
    gitLog.mockResolvedValue({ ok: true, commits: [target] });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    fireEvent.contextMenu(await screen.findByRole("listitem"));
    expect(await screen.findByRole("status")).toHaveTextContent("published");
    expect(screen.queryByRole("menuitem", { name: "Rename commit" })).toBeNull();
    expect(window.hermesAPI.gitRenameCommit).not.toHaveBeenCalled();
  });
  it("keeps rename absent while validation is pending or local changes block it", async () => {
    const target = { ...commit("d".repeat(40), [], "latest"), refs: ["HEAD -> main"] };
    gitLog.mockResolvedValue({ ok: true, commits: [target] });
    let finish!: (result: { ok: boolean; error: string }) => void;
    vi.mocked(window.hermesAPI.gitRenameCheck).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    fireEvent.contextMenu(await screen.findByRole("listitem"));
    expect(await screen.findByRole("status")).toHaveTextContent("Checking rename eligibility");
    expect(screen.queryByRole("menuitem", { name: "Rename commit" })).toBeNull();
    await act(async () => finish({ ok: false, error: "Commit or stash local changes before renaming a commit" }));
    expect(screen.getByRole("status")).toHaveTextContent("Commit or stash local changes");
    expect(screen.queryByLabelText("Commit message", { selector: "textarea[id]" })).toBeNull();
  });
  it("omits rename entirely on older local commits", async () => {
    const target = { ...commit("c".repeat(40), [], "older local commit"), refs: ["local-branch"] };
    gitLog.mockResolvedValue({ ok: true, commits: [target] });
    vi.mocked(window.hermesAPI.gitRenameCheck).mockResolvedValue({ ok: false, error: "Only the latest commit on the current local branch can be renamed" });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    fireEvent.contextMenu(await screen.findByRole("listitem"));
    expect(screen.queryByRole("menuitem", { name: "Rename commit" })).toBeNull();
    expect(window.hermesAPI.gitRenameCheck).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitRenameCommit).not.toHaveBeenCalled();
  });
  it("saves a renamed local HEAD after confirmation and refreshes history", async () => {
    const target = { ...commit("b".repeat(40), [], "original"), refs: ["HEAD -> main"] };
    gitLog.mockResolvedValue({ ok: true, commits: [target] });
    vi.mocked(window.hermesAPI.gitRenameCheck).mockResolvedValue({ ok: true, output: "original\n\nbody" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    fireEvent.contextMenu(await screen.findByRole("listitem"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename commit" }));
    const input = await screen.findByLabelText("Commit message", { selector: "textarea[id]" });
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    await waitFor(() => expect(input).toHaveValue("original\n\nbody"));
    fireEvent.change(input, { target: { value: "updated\n\nbody" } });
    fireEvent.click(screen.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(window.hermesAPI.gitRenameCommit).toHaveBeenCalledWith("/repo", target.hash, "updated\n\nbody"));
    await waitFor(() => expect(gitLog).toHaveBeenCalledTimes(2));
    confirm.mockRestore();
  });
  it("resizes both split tabs and opens reference docs without running Git", async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [] });
    renderDialog("/repo");
    const changes = await screen.findByRole("separator", { name: "Changes pane width" });
    fireEvent.keyDown(changes, { key: "ArrowRight" });
    expect(changes).toHaveAttribute("aria-valuenow", "37");
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    const graph = screen.getByRole("separator", { name: "Graph pane width" });
    fireEvent.keyDown(graph, { key: "End" });
    expect(graph).toHaveAttribute("aria-valuenow", "80");
    fireEvent.click(screen.getByRole("button", { name: "Git Doc" }));
    expect(screen.getByRole("heading", { name: "Common Git commands" })).toBeTruthy();
    expect(screen.getByText("git status")).toBeTruthy();
    expect(window.hermesAPI.terminalCreate).not.toHaveBeenCalled();
  });
  it("keeps terminals across tabs and confirms every Source Control exit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const close = vi.fn();
    renderDialog("/repo", close);
    fireEvent.click(await screen.findByRole("button", { name: "Terminal" }));
    await screen.findByText("Close terminal source-term");
    const dockNode = screen.getByText("Close terminal source-term");
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("aria-pressed", "true");
    expect(sourceControlCss).toMatch(/\.source-control-terminal-toggle\[aria-pressed="true"\]\s*\{[^}]*background:[^}]*box-shadow:/);
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("title", "Hide terminal pane (sessions keep running)");
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("title", "Show terminal pane");
    expect(screen.getByLabelText("Source Control terminals")).not.toBeVisible();
    expect(window.hermesAPI.terminalKill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(screen.getByText("Close terminal source-term")).toBe(dockNode);
    expect(window.hermesAPI.terminalCreate).toHaveBeenCalledOnce();
    const terminalWidth = screen.getByRole("separator", { name: "Terminal pane width" });
    fireEvent.keyDown(terminalWidth, { key: "ArrowLeft" });
    expect(terminalWidth).toHaveAttribute("aria-valuenow", "60");
    fireEvent.click(screen.getByRole("button", { name: "Git Doc" }));
    expect(screen.getByText("Close terminal source-term")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => undefined);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("source-term");
    confirm.mockRestore();
  });
  it("protects terminals on Escape and credential navigation, but shell Escape stays in the shell", async () => {
    vi.mocked(window.hermesAPI.gitRemoteHost).mockResolvedValue("github.com");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const close = vi.fn(); openSettings.mockClear();
    renderDialog("/repo", close);
    const credentials = await screen.findByRole("button", { name: "Manage GitHub Credentials" });
    const terminal = screen.getByRole("button", { name: "Terminal" });
    expect(terminal.querySelector("svg")).toBeNull();
    expect(terminal.compareDocumentPosition(credentials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(terminal);
    await screen.findByText("Close terminal source-term");
    const terminalWidth = screen.getByRole("separator", { name: "Terminal pane width" });
    fireEvent.keyDown(terminalWidth, { key: "ArrowLeft" });
    expect(terminalWidth).toHaveAttribute("aria-valuenow", "60");
    fireEvent.keyDown(screen.getByRole("button", { name: "New terminal session" }), { key: "Escape" });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    await act(async () => undefined);
    fireEvent.click(credentials);
    await act(async () => undefined);
    expect(close).not.toHaveBeenCalled(); expect(openSettings).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(credentials);
    await waitFor(() => expect(openSettings).toHaveBeenCalledWith("github"));
    expect(window.hermesAPI.terminalKill).toHaveBeenCalledWith("source-term");
    confirm.mockRestore();
  });
  it("opens heading-only context actions by keyboard, bounds position, closes outside and Escape", async () => {
    const onClose = vi.fn();
    renderDialog("/repo", onClose);
    const heading = await screen.findByText(/^Changes \(/);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(heading.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(heading.querySelector(".lucide-chevron-down")).not.toBeNull();
    fireEvent.contextMenu(screen.getByText("a.ts"));
    expect(screen.getByRole("menuitem", { name: "Discard changes to a.ts" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(heading, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(heading).toHaveFocus();
    fireEvent.keyDown(heading, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(heading, { clientX: 9999, clientY: 9999 });
    expect(screen.getByRole("menu")).toHaveStyle({ left: `${window.innerWidth - 210}px`, top: `${window.innerHeight - 48}px` });
  });
  it("confirms before discarding a tracked change and refreshes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderDialog("/repo");
    const file = await screen.findByRole("button", { name: /a.ts M/ });
    expect(screen.queryByRole("button", { name: "Discard changes to a.ts" })).toBeNull();
    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes to a.ts" }));
    expect(window.hermesAPI.gitDiscard).not.toHaveBeenCalled();
    fireEvent.keyDown(file, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes to a.ts" }));
    await waitFor(() => expect(window.hermesAPI.gitDiscard).toHaveBeenCalledWith("/repo", "a.ts"));
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalledTimes(2));
    confirm.mockRestore();
  });
  it("opens GitHub credential settings without reading the legacy token", async () => {
    vi.mocked(window.hermesAPI.gitRemoteHost).mockResolvedValue("github.com");
    const onClose = vi.fn();
    openSettings.mockClear();
    renderDialog("/repo", onClose);
    const credentials = await screen.findByRole("button", { name: "Manage GitHub Credentials" });
    expect(credentials.closest(".source-control-header-actions")).not.toBeNull();
    fireEvent.click(credentials);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await waitFor(() => expect(openSettings).toHaveBeenCalledWith("github"));
    expect(window.hermesAPI.gitGetToken).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Personal access token")).toBeNull();
  });

  it("retains per-host token entry for non-GitHub remotes", async () => {
    vi.mocked(window.hermesAPI.gitRemoteHost).mockResolvedValue("gitlab.com");
    renderDialog("/repo");
    const input = await screen.findByPlaceholderText("Personal access token");
    fireEvent.change(input, { target: { value: "example-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    expect(window.hermesAPI.gitSetToken).toHaveBeenCalledWith("gitlab.com", "example-token");
  });
  it("shows readable output with a keyboard-adjustable height and announces errors", async () => {
    vi.mocked(window.hermesAPI.gitFetch).mockResolvedValueOnce({ ok: true, output: "Fetched refs" }).mockResolvedValueOnce({ ok: false, error: "Fetch failed" });
    renderDialog("/repo");
    const fetch = await screen.findByRole("button", { name: /fetch/i });
    await act(async () => fetch.click());
    const output = await screen.findByRole("status");
    expect(output).toHaveTextContent("Fetched refs");
    expect(output).toHaveStyle({ height: "120px" });
    fireEvent.keyDown(screen.getByRole("separator", { name: "Output height" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("separator", { name: "Output height" }), { key: "Home" });
    for (let i = 0; i < 16; i++) fireEvent.keyDown(screen.getByRole("separator", { name: "Output height" }), { key: "ArrowUp" });
    expect(screen.queryByRole("slider")).toBeNull();
    expect(output).toHaveStyle({ height: "240px" });
    await act(async () => fetch.click());
    expect(await screen.findByRole("alert")).toHaveTextContent("Fetch failed");
    expect(screen.getByRole("separator", { name: "Output height" })).toHaveAttribute("aria-valuenow", "240");
  });
  it("keeps keyboard and drag bounds aligned with viewport resizing", async () => {
    const originalHeight = window.innerHeight;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
      vi.mocked(window.hermesAPI.gitFetch).mockResolvedValue({ ok: true, output: "Fetched refs" });
      renderDialog("/repo");
      const fetch = await screen.findByRole("button", { name: /fetch/i });
      await act(async () => fetch.click());
      const output = await screen.findByRole("status");
      const slider = screen.getByRole("separator", { name: "Output height" });
      expect(slider).toHaveAttribute("aria-valuemax", "240");
      fireEvent.keyDown(slider, { key: "End" });
      expect(output).toHaveStyle({ height: "240px" });
      const divider = document.querySelector(".source-control-output-divider") as HTMLElement;
      divider.setPointerCapture = vi.fn();
      fireEvent(divider, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 200 }));
      fireEvent(divider, new MouseEvent("pointermove", { bubbles: true, button: 0, clientY: -500 }));
      expect(output).toHaveStyle({ height: "240px" });
      act(() => {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
        window.dispatchEvent(new Event("resize"));
      });
      expect(slider).toHaveAttribute("aria-valuemax", "160");
      expect(slider).toHaveAttribute("aria-valuenow", "160");
      expect(output).toHaveStyle({ height: "160px" });
      act(() => {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
        window.dispatchEvent(new Event("resize"));
      });
      expect(slider).toHaveAttribute("aria-valuemax", "400");
      expect(slider).toHaveAttribute("aria-valuenow", "160");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });
  it("opens the branch manager from the badge and Escape keeps source control open", async () => {
    Object.assign(window.hermesAPI, { gitBranches: vi.fn().mockResolvedValue({ ok: true, current: "main", branches: [{ name: "main", current: true, checkedOut: true }] }) });
    const onClose = vi.fn();
    renderDialog("/repo", onClose);
    fireEvent.click(await screen.findByRole("button", { name: "Manage local branches" }));
    expect(await screen.findByRole("dialog", { name: "Local branches" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
  it("closes Git output and shows it again after another result", async () => {
    vi.mocked(window.hermesAPI.gitFetch).mockResolvedValue({ ok: true, output: "Fetched refs" });
    renderDialog("/repo");
    const fetch = await screen.findByRole("button", { name: /fetch/i });
    fireEvent.click(fetch);
    await screen.findByText("Fetched refs");
    fireEvent.click(screen.getByRole("button", { name: "Close Git output" }));
    expect(screen.queryByRole("region", { name: "Git output" })).toBeNull();
    await waitFor(() => expect(fetch).not.toBeDisabled());
    fireEvent.click(fetch);
    expect(await screen.findByText("Fetched refs")).toBeTruthy();
  });
  it("drags the output divider within bounds and stops on cancellation", async () => {
    vi.mocked(window.hermesAPI.gitFetch).mockResolvedValue({ ok: true, output: "Fetched refs" });
    renderDialog("/repo");
    const fetch = await screen.findByRole("button", { name: /fetch/i });
    await act(async () => fetch.click());
    const output = await screen.findByRole("status");
    const divider = document.querySelector(".source-control-output-divider") as HTMLElement;
    divider.setPointerCapture = vi.fn();
    // jsdom does not implement PointerEvent; use MouseEvent for pointer coordinates.
    const pointer = (type: string, y: number) => fireEvent(divider, new MouseEvent(type, { bubbles: true, button: 0, clientY: y }));
    pointer("pointerdown", 200);
    pointer("pointermove", 100);
    expect(output).toHaveStyle({ height: "220px" });
    pointer("pointermove", -500);
    expect(output).toHaveStyle({ height: `${Math.min(400, Math.floor(window.innerHeight * 0.4))}px` });
    pointer("pointermove", 500);
    expect(output).toHaveStyle({ height: "80px" });
    pointer("pointercancel", 500);
    pointer("pointermove", 100);
    expect(output).toHaveStyle({ height: "80px" });
  });
  it("ignores only untracked rows and refreshes status without staging or deleting", async () => {
    const initial = await gitRepoStatus();
    gitRepoStatus.mockResolvedValue({ ...initial, untracked: ["new.txt"] });
    window.hermesAPI.gitIgnoreAdd = vi.fn().mockResolvedValue({ ok: true });
    renderDialog("/repo");
    const ignore = await screen.findByRole("button", { name: "Ignore new.txt" });
    expect(screen.getByRole("button", { name: "Ignore a.ts" })).toBeDisabled();
    await act(async () => ignore.click());
    expect(window.hermesAPI.gitIgnoreAdd).toHaveBeenCalledWith("/repo", "new.txt");
    expect(window.hermesAPI.gitStage).not.toHaveBeenCalled();
    expect(gitRepoStatus).toHaveBeenCalledTimes(3);
  });

  it("lists root rules separately and removes a selected rule with confirmation and version", async () => {
    window.hermesAPI.gitIgnoreList = vi.fn().mockResolvedValue({ ok: true, rules: [{ line: 2, pattern: "*.cache" }], files: ["node_modules/"], version: "version", hasMore: false });
    window.hermesAPI.gitIgnoreRemove = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog("/repo");
    await screen.findByText("Ignored");
    await act(async () => { screen.getByText("Ignored").click(); });
    expect(await screen.findByText("node_modules/")).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Remove ignore rule *.cache" }).click());
    expect(window.hermesAPI.gitIgnoreRemove).toHaveBeenCalledWith("/repo", 2, "*.cache", "version");
    expect(window.confirm).toHaveBeenCalled();
    vi.mocked(window.confirm).mockRestore();
  });
  // @lat: [[source-control#Source Control (git)#Stage all changes]]
  it("stages tracked, deleted, and untracked paths once, excludes conflicts, and refreshes before unlocking", async () => {
    const initial = await gitRepoStatus();
    gitRepoStatus.mockClear();
    const paths = ["a.ts", "deleted file.ts", "new file.ts"];
    gitRepoStatus.mockResolvedValueOnce({ ...initial,
      unstaged: [
        { index: " ", worktree: "M", path: paths[0] },
        { index: " ", worktree: "D", path: paths[1] },
      ],
      untracked: [paths[2]],
      conflicted: [{ index: "U", worktree: "U", path: "conflict.ts" }],
    });
    let finishStage!: (value: { ok: boolean }) => void;
    let finishRefresh!: (value: typeof initial) => void;
    vi.mocked(window.hermesAPI.gitStage).mockImplementation(() => new Promise((resolve) => { finishStage = resolve; }));
    gitRepoStatus.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    renderDialog("/repo");
    const heading = await screen.findByText(/^Changes \(/);
    fireEvent.contextMenu(heading);
    const button = screen.getByRole("menuitem", { name: "Stage all changes" });
    await act(async () => { button.click(); button.click(); });
    expect(window.hermesAPI.gitStage).toHaveBeenCalledWith("/repo", paths);
    fireEvent.contextMenu(heading);
    expect(screen.getByRole("menuitem", { name: "Stage all changes" })).toBeDisabled();
    await act(async () => finishStage({ ok: true }));
    fireEvent.contextMenu(heading);
    expect(screen.getByRole("menuitem", { name: "Stage all changes" })).toBeDisabled();
    await act(async () => finishRefresh({ ...initial,
      staged: paths.map((path) => ({ index: "M", worktree: " ", path })),
      unstaged: [], untracked: [],
    }));
    expect(await screen.findByText("Staged (3)")).toBeTruthy();
    fireEvent.contextMenu(heading);
    expect(screen.getByRole("menuitem", { name: "Stage all changes" })).toBeDisabled();
    expect(window.hermesAPI.gitStage).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.gitPush).not.toHaveBeenCalled();
  });

  it.each([false, true])("surfaces stage-all failures and permits retry (throw=%s)", async (throws) => {
    vi.mocked(window.hermesAPI.gitStage).mockImplementationOnce(async () => {
      if (throws) throw new Error("index locked");
      return { ok: false, error: "index locked" };
    });
    renderDialog("/repo");
    const heading = await screen.findByText(/^Changes \(/);
    fireEvent.contextMenu(heading);
    const button = screen.getByRole("menuitem", { name: "Stage all changes" });
    await act(async () => button.click());
    expect(await screen.findByText(/index locked/)).toBeTruthy();
    fireEvent.contextMenu(heading);
    expect(screen.getByRole("menuitem", { name: "Stage all changes" })).not.toBeDisabled();
    expect(gitRepoStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces a refresh failure without leaving staging busy", async () => {
    gitRepoStatus.mockResolvedValueOnce(await gitRepoStatus()).mockRejectedValueOnce(new Error("refresh failed"));
    renderDialog("/repo");
    const heading = await screen.findByText(/^Changes \(/);
    fireEvent.contextMenu(heading);
    const button = screen.getByRole("menuitem", { name: "Stage all changes" });
    await act(async () => button.click());
    expect(await screen.findByText(/refresh failed/)).toBeTruthy();
    fireEvent.contextMenu(heading);
    expect(screen.getByRole("menuitem", { name: "Stage all changes" })).not.toBeDisabled();
  });
  it("selects an ordered shift range without opening diffs, then stages only that range", async () => {
    gitRepoStatus.mockResolvedValue({
      repo: true, root: "/repo", branch: "main", upstream: null, ahead: 0, behind: 0,
      conflicted: [], staged: [],
      unstaged: [
        { index: " ", worktree: "M", path: "one.ts" },
        { index: " ", worktree: "M", path: "two.ts" },
        { index: " ", worktree: "M", path: "three.ts" },
      ],
      untracked: ["four.ts"],
    });
    renderDialog("/repo");
    const one = await screen.findByRole("checkbox", { name: "Select one.ts" });
    const three = screen.getByRole("checkbox", { name: "Select three.ts" });
    fireEvent.click(one);
    fireEvent.click(three, { shiftKey: true });
    expect(one).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select two.ts" })).toBeChecked();
    expect(three).toBeChecked();
    expect(gitDiff).not.toHaveBeenCalled();
    await act(async () => screen.getByRole("button", { name: "Stage selected (3)" }).click());
    expect(window.hermesAPI.gitStage).toHaveBeenCalledWith("/repo", ["one.ts", "two.ts", "three.ts"]);
  });

  it("keeps normal file clicks opening the diff", async () => {
    renderDialog("/repo");
    await screen.findByText("a.ts");
    await act(async () => screen.getByText("a.ts").click());
    expect(gitDiff).toHaveBeenCalledWith("/repo", "a.ts", false);
  });

  it("offers stage and ignore together for the same selection", async () => {
    gitRepoStatus.mockResolvedValue({
      repo: true, root: "/repo", branch: "main", upstream: null, ahead: 0, behind: 0,
      conflicted: [], staged: [],
      unstaged: [{ index: " ", worktree: "M", path: "edited.ts" }],
      untracked: ["one.log", "two.log"],
    });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select one.log" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select two.log" }), { shiftKey: true });
    // Both batch actions must exist simultaneously — one must not replace the other.
    expect(screen.getByRole("button", { name: "Stage selected (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ignore selected (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Clear selection" }).click());
    expect(screen.queryByRole("button", { name: "Stage selected (2)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stage all changes" })).toBeNull();
  });

  it("counts only untracked rows as ignorable in a mixed selection", async () => {
    gitRepoStatus.mockResolvedValue({
      repo: true, root: "/repo", branch: "main", upstream: null, ahead: 0, behind: 0,
      conflicted: [], staged: [],
      unstaged: [
        { index: " ", worktree: "M", path: "edited.ts" },
        { index: " ", worktree: "M", path: "other.ts" },
      ],
      untracked: ["new.log"],
    });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select edited.ts" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select new.log" }), { shiftKey: true });
    // Tracked rows are staged; only the untracked one can be ignored.
    expect(screen.getByRole("button", { name: "Stage selected (3)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ignore selected (1)" })).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Ignore selected (1)" }).click());
    expect(window.hermesAPI.gitIgnoreAddMany).toHaveBeenCalledWith("/repo", ["new.log"]);
  });

  it("ignores the whole multi-selection in one call, not one rule per row", async () => {
    gitRepoStatus.mockResolvedValue({
      repo: true, root: "/repo", branch: "main", upstream: null, ahead: 0, behind: 0,
      conflicted: [], staged: [], unstaged: [],
      untracked: ["one.log", "two.log", "three.log"],
    });
    window.hermesAPI.gitIgnoreAddMany = vi.fn().mockResolvedValue({ ok: true });
    renderDialog("/repo");
    const one = await screen.findByRole("checkbox", { name: "Select one.log" });
    const three = screen.getByRole("checkbox", { name: "Select three.log" });
    fireEvent.click(one);
    fireEvent.click(three, { shiftKey: true });
    await act(async () => screen.getByRole("button", { name: "Ignore selected (3)" }).click());
    expect(window.hermesAPI.gitIgnoreAddMany).toHaveBeenCalledWith("/repo", ["one.log", "two.log", "three.log"]);
    expect(window.hermesAPI.gitIgnoreAdd).not.toHaveBeenCalled();
    expect(window.hermesAPI.gitStage).not.toHaveBeenCalled();
  });

  it("renders as a full-page panel portaled to <body> (not a nested modal)", async () => {
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());
    // Portaled out of the mount subtree, and using the full-page host class —
    // this is what stops the FloatingDialog from clipping the bottom.
    const page = document.querySelector(".source-control-page");
    expect(page).toBeTruthy();
    expect(page?.parentElement).toBe(document.body);
  });

  it("provides hover explanation for status codes and keeps eye before stage action", async () => {
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());
    const code = screen.getByText("M");
    expect(code).toHaveAttribute("title", "Modified");
    const actions = code.closest(".source-control-file")!.querySelector(".source-control-file-actions")!;
    const buttons = actions.querySelectorAll("button");
    expect(buttons[0]).toHaveAttribute("aria-label", "Ignore a.ts");
    expect(buttons[1]).toHaveAttribute("aria-label", "Stage");
  });

  it("does not fetch history until the Graph tab is opened", async () => {
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());
    expect(gitLog).not.toHaveBeenCalled();
  });

  it("keeps graph loading separate from empty history and reserves its lane gutter", async () => {
    let resolve!: (value: { ok: boolean; commits: ReturnType<typeof commit>[] }) => void;
    gitLog.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderDialog("/repo");
    const graph = await screen.findByRole("button", { name: "Graph" });
    expect(document.querySelectorAll("summary")).not.toContainEqual(expect.objectContaining({ textContent: "Graph" }));
    expect(screen.getByRole("button", { name: "Pull" }).querySelector("svg")).toBeNull();
    fireEvent.click(graph);
    expect(screen.getByRole("status").textContent).toBe("Loading history…");
    const refresh = screen.getByRole("button", { name: "Refresh history" });
    expect(refresh.closest(".source-control-graph-toolbar")!.nextElementSibling).toBe(screen.getByRole("status"));
    expect(screen.queryByText("No commits yet")).toBeNull();
    await act(async () => resolve({ ok: true, commits: [commit("aaaaaaa1", [], "loaded")] }));
    expect(screen.getByText("loaded")).toBeTruthy();
    expect(parseFloat((document.querySelector(".commit-graph-rows") as HTMLElement).style.marginLeft)).toBeGreaterThan(0);
  });

  it("applies date filters only on Apply and refreshes the applied range", async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [commit("aaaaaaa1", [], "unfiltered")] });
    renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    await screen.findByText("unfiltered");
    const filterForm = screen.getByRole("button", { name: "Apply" }).closest("form")!;
    expect(filterForm).toHaveClass("source-control-graph-filters");
    const filterStyle = sourceControlCss.match(/\.source-control-graph-filters\s*\{([^}]+)\}/)![1];
    expect(filterStyle).toMatch(/align-items:\s*flex-end/);
    expect(filterStyle).toMatch(/flex-wrap:\s*nowrap/);
    expect(gitLog).toHaveBeenLastCalledWith("/repo", { max: 50 });
    fireEvent.change(screen.getByLabelText("History from"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("History to"), { target: { value: "2020-01-02" } });
    expect(gitLog).toHaveBeenCalledTimes(1);
    gitLog.mockResolvedValue({ ok: true, commits: [] });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(gitLog).toHaveBeenLastCalledWith("/repo", { max: 50, from: "2020-01-01", to: "2020-01-02" }));
    await screen.findByText("No commits yet");
    fireEvent.change(screen.getByLabelText("History from"), { target: { value: "2020-01-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(gitLog).toHaveBeenCalledTimes(3));
    expect(gitLog).toHaveBeenLastCalledWith("/repo", { max: 50, from: "2020-01-01", to: "2020-01-02" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("History from"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("History to"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(gitLog).toHaveBeenCalledTimes(4));
    expect(gitLog).toHaveBeenLastCalledWith("/repo", { max: 50 });
  });

  it("loads and renders commits when the Graph tab is clicked", async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [
        commit("aaaaaaa1", ["bbbbbbb2"], "newest work"),
        commit("bbbbbbb2", [], "initial"),
      ],
    });
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());

    await act(async () => {
      screen.getByRole("button", { name: "Graph" }).click();
    });

    await waitFor(() =>
      expect(gitLog).toHaveBeenCalledWith("/repo", { max: 50 }),
    );
    expect(await screen.findByText("newest work")).toBeTruthy();
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("dismisses the commit menu when the graph scrolls, not an unrelated pane", async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [commit("abcdef12", [], "target commit")] });
    const { unmount } = renderDialog("/repo");
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
    const row = await screen.findByRole("listitem");
    fireEvent.contextMenu(row);
    fireEvent.scroll(document.querySelector(".source-control-graph-diff")!);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.scroll(document.querySelector(".commit-graph-scroll")!);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menu")).toBeTruthy();
    unmount();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.scroll(document);
  });

  it("right clicks a commit to copy hash or revert with confirmation, and supports cancel revert", async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [commit("abcdef12", [], "target commit")],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    const row = await screen.findByRole("listitem");
    expect(screen.queryByRole("button", { name: "Cancel revert" })).toBeNull();

    // Context menu on commit row
    fireEvent.contextMenu(row);
    const copyBtn = screen.getByRole("menuitem", { name: "Copy commit ID" });
    expect(screen.getByRole("menuitem", { name: "Revert to this commit" })).toBeTruthy();

    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith("abcdef12");

    // Revert with rejection
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert to this commit" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Revert commit abcdef1"));
    expect(gitRevert).not.toHaveBeenCalled();

    // Revert confirmed
    confirm.mockReturnValue(true);
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert to this commit" }));
    await waitFor(() => expect(gitRevert).toHaveBeenCalledWith("/repo", "abcdef12"));

    // Cancel revert button when reverting
    gitRepoStatus.mockResolvedValueOnce({
      repo: true,
      root: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      conflicted: [],
      staged: [],
      unstaged: [],
      untracked: [],
      reverting: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel revert" })).not.toBeDisabled());
    const cancelBtn = screen.getByRole("button", { name: "Cancel revert" });

    confirm.mockReturnValue(false);
    fireEvent.click(cancelBtn);
    expect(gitRevertAbort).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(gitRevertAbort).toHaveBeenCalledWith("/repo"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel revert" })).toBeNull());

    confirm.mockRestore();
  });

  it("shows the selected commit's diff", async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [commit("aaaaaaa1", [], "solo commit")],
    });
    gitCommitDiff.mockResolvedValue({
      ok: true,
      output: "@@ -1 +1 @@\n-old line\n+new line",
    });
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());

    await act(async () => {
      screen.getByRole("button", { name: "Graph" }).click();
    });
    const row = await screen.findByText("solo commit");
    await act(async () => {
      row.click();
    });

    await waitFor(() =>
      expect(gitCommitDiff).toHaveBeenCalledWith("/repo", "aaaaaaa1"),
    );
    // The viewer tokenizes the hunk, so "new line" is split across spans —
    // assert on the diff body text as a whole.
    await waitFor(() => {
      const body = document.querySelector(".diff-viewer-body");
      expect(body?.textContent).toContain("new line");
      expect(body?.textContent).toContain("old line");
    });
  });

  it("renders the changes tab diff with real line stats", async () => {
    gitRepoStatus.mockResolvedValue({
      repo: true,
      root: "/repo",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      conflicted: [],
      staged: [],
      unstaged: [{ index: " ", worktree: "M", path: "a.ts" }],
      untracked: [],
    });
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());

    // Selecting the changed file calls gitDiff; feed it a real diff.
    gitDiff.mockResolvedValue({
      ok: true,
      output: "--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n keep\n-gone\n+added",
    });
    await act(async () => {
      screen.getByText("a.ts").click();
    });

    await waitFor(() =>
      expect(gitDiff).toHaveBeenCalledWith("/repo", "a.ts", false),
    );
    // -1 / +1 stat chips prove the viewer parsed and counted the hunk.
    expect(await screen.findByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("keeps focus in the commit box while typing (no remount per character)", async () => {
    // THE bug: Shell/Section/FileRow were defined inside the component body, so
    // each render produced new component TYPES and React remounted the subtree —
    // destroying and recreating the commit textarea on every keystroke, which
    // dropped focus after one character. A stable module-scope Shell keeps the
    // same DOM node, so focus survives.
    gitRepoStatus.mockResolvedValue({
      repo: true,
      root: "/repo",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      conflicted: [],
      staged: [{ index: "M", worktree: " ", path: "a.ts" }],
      unstaged: [],
      untracked: [],
    });
    renderDialog("/repo");
    await waitFor(() => expect(gitRepoStatus).toHaveBeenCalled());

    const textarea = await screen.findByPlaceholderText(/Commit message/);
    const node = textarea as HTMLTextAreaElement;

    // Type character by character through the real React onChange path.
    act(() => {
      node.focus();
    });
    expect(document.activeElement).toBe(node);

    for (const char of "hello") {
      act(() => {
        node.value += char;
        node.dispatchEvent(new Event("input", { bubbles: true }));
      });
      // The SAME node must still be focused after each keystroke. Under the
      // remount bug this fails on the first character.
      expect(document.activeElement).toBe(node);
    }

    expect(node.value).toBe("hello");
    // Still the same DOM element, not a fresh replacement (the dialog portals
    // to <body>, so look there rather than in the render container).
    expect(document.body.querySelector("textarea")).toBe(node);
  });

  it("switches the diff split into tabs below 760px", () => {
    expect(isNarrowSourceControl(759)).toBe(true);
    expect(isNarrowSourceControl(760)).toBe(false);
    // An unmeasured host (0px) must not be treated as narrow on its own.
    expect(isNarrowSourceControl(0)).toBe(false);
  });

  it("switches to a floating, resizable window and back", async () => {
    renderDialog("/repo");
    const float = await screen.findByRole("button", {
      name: "Float source control in a window",
    });
    expect(float.getAttribute("aria-pressed")).toBe("false");

    // A running terminal must survive the layout swap (the dock remounts).
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    });
    expect(
      await screen.findByRole("button", { name: "Close terminal source-term" }),
    ).toBeTruthy();

    act(() => {
      fireEvent.click(float);
    });

    await waitFor(() =>
      expect(document.querySelector(".source-control-floating")).not.toBeNull(),
    );
    // Same chrome as the other floating tools: drag handle, resize handles,
    // and a close control that reports the panel title.
    expect(
      document.querySelector(".source-control-floating.terminal-dialog"),
    ).not.toBeNull();
    expect(document.querySelector(".terminal-dialog-resize")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Source Control — repo" })).toBeTruthy();
    expect(localStorage.getItem("hermes.sourceControl.floating")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Close terminal source-term" }),
    ).toBeTruthy();

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Dock source control as a full page" }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector(".source-control-page")).not.toBeNull(),
    );
    expect(localStorage.getItem("hermes.sourceControl.floating")).toBe("0");
  });

  it("shows the pane switcher instead of the split on a narrow panel", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 700,
    });
    try {
      renderDialog("/repo");
      const tabs = await screen.findByRole("tablist", { name: "Changes layout" });
      // The header actions collapse to one compact icon row, matching the tabs.
      expect(document.querySelector(".source-control-header.is-compact")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Fetch" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Pull" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Push" })).toBeTruthy();
      const changes = within(tabs).getByRole("tab", { name: "Changes" });
      const diff = within(tabs).getByRole("tab", { name: "Diff" });
      expect(changes.getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector(".source-control-split--narrow")).not.toBeNull();

      act(() => {
        fireEvent.click(diff);
      });
      expect(diff.getAttribute("aria-selected")).toBe("true");
      expect(
        document.querySelector(".source-control-split--narrow.is-diff"),
      ).not.toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: original,
      });
    }
  });
});
