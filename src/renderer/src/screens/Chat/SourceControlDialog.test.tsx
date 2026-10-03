import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "../../components/I18nProvider";
import { SourceControlDialog } from "./SourceControlDialog";

/** The dialog uses `t` from useI18n, which requires the provider. */
function renderDialog(
  dir: string,
  onClose: () => void = vi.fn(),
): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <SourceControlDialog dir={dir} onClose={onClose} />
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
    gitUnstage: vi.fn().mockResolvedValue({ ok: true }),
    gitCommit: vi.fn().mockResolvedValue({ ok: true }),
    gitPull: vi.fn().mockResolvedValue({ ok: true }),
    gitPush: vi.fn().mockResolvedValue({ ok: true }),
    gitFetch: vi.fn().mockResolvedValue({ ok: true }),
    gitResolveConflict: vi.fn().mockResolvedValue({ ok: true }),
  };
});

describe("SourceControlDialog", () => {
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
      screen.getByText("Graph").click();
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
      screen.getByText("Graph").click();
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
});
