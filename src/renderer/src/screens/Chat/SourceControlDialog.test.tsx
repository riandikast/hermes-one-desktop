import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../components/I18nProvider";
import { SourceControlDialog } from "./SourceControlDialog";
import { SettingsModalContext } from "../../components/settings/SettingsModalContext";

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

beforeEach(() => {
  gitLog.mockReset();
  gitRepoStatus.mockReset();
  gitDiff.mockReset();
  gitCommitDiff.mockReset();

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
  };
});

describe("SourceControlDialog", () => {
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
    const credentials = await screen.findByRole("button", { name: "Manage GitHub credentials" });
    expect(credentials.closest(".source-control-header-actions")).not.toBeNull();
    fireEvent.click(credentials);
    expect(onClose).toHaveBeenCalledOnce();
    expect(openSettings).toHaveBeenCalledWith("github");
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
    expect(screen.getByRole("button", { name: "Refresh history" }).nextElementSibling).toBe(screen.getByRole("status"));
    expect(screen.queryByText("No commits yet")).toBeNull();
    await act(async () => resolve({ ok: true, commits: [commit("aaaaaaa1", [], "loaded")] }));
    expect(screen.getByText("loaded")).toBeTruthy();
    expect(parseFloat((document.querySelector(".commit-graph-rows") as HTMLElement).style.marginLeft)).toBeGreaterThan(0);
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
      expect(gitLog).toHaveBeenCalledWith("/repo", { max: 60 }),
    );
    expect(await screen.findByText("newest work")).toBeTruthy();
    expect(screen.getByText("initial")).toBeTruthy();
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
});
