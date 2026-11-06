import { fireEvent, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeKnowledgePrompt } from "../../../../shared/knowledge-envelope";
import { renderWithI18n } from "../../test/renderWithI18n";
import { FileChangeHistoryDialog } from "./FileChangeHistoryDialog";
import { FileChangesRow } from "./MessageList";
import { FileChangesDialog } from "./FileChangesDialog";
import type { ChatMessage, FileChange } from "./types";
import { resolveHistoryExplorerTarget } from "./fileChangeHistory";
import { readFileSync } from "node:fs";
import { fileSummaryFooters } from "./fileChangeSummary";

const readDirectory = vi.fn();
afterEach(() => vi.restoreAllMocks());
vi.mock("./SourceControlDialog", () => ({ SourceControlDialog: () => null }));
vi.mock("./FindInFilesDialog", () => ({ FindInFilesDialog: () => null }));


const change: FileChange = {
  path: "src/long path.ts",
  before: "a",
  after: "b",
};
const messages: ChatMessage[] = [
  { id: "manual", role: "user", content: "Manual prompt" },
  { id: "chip", kind: "file_changes", role: "agent", changes: [change] },
];
function selectPrompt(prompt: string): void {
  const list = within(screen.getByRole("navigation", { name: "File change history" }));
  fireEvent.click(list.getByRole("button", { name: new RegExp(prompt) }));
  const detail = screen.getByRole("region", { name: prompt });
  const files = historySection(detail, "Files");
  if (!files.open) fireEvent.click(files.querySelector("summary")!);
}
function historySection(region: HTMLElement, title: string): HTMLDetailsElement {
  return [...region.querySelectorAll<HTMLDetailsElement>("details.file-change-history-section")].find(
    (section) => section.querySelector("summary")?.textContent?.includes(title),
  )!;
}
afterEach(cleanup);
describe("file change history dialog", () => {
  it("gives filenames their own wrapping line when large-file status text is long", () => {
    const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
    const rule = (selector: string): string => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    expect(rule(".file-changes-item")).toContain("flex-direction: column");
    expect(rule(".file-changes-item")).toContain("align-items: stretch");
    expect(rule(".file-changes-item")).toContain("flex-shrink: 0");
    expect(rule(".file-changes-item-name")).toContain("white-space: normal");
    expect(rule(".file-changes-item-name")).toContain("overflow-wrap: anywhere");
    expect(rule(".file-changes-item-name")).not.toContain("overflow: hidden");
    expect(rule(".file-changes-item-stats")).toContain("overflow-wrap: anywhere");
    const name = "VeryLongMainControllerWithValidationAndPropertySelection.php";
    renderWithI18n(<FileChangesDialog changes={[{
      path: `C:/repo/${name}`, before: Array(1100).fill("before").join("\n"), after: Array(1100).fill("after").join("\n"), source: "workspace",
    }]} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: new RegExp(name) })).toHaveAttribute("title", `C:/repo/${name}`);
    expect(screen.getAllByText("Changed — file too large to diff")).toHaveLength(2);
  });
  it("keeps an already-open chip dialog synced with late workspace and child files", () => {
    const chip: ChatMessage = { id: "chip", kind: "file_changes", role: "agent", changes: [change] };
    const initial = [...messages.slice(0, 1), chip];
    const props = { changes: [change], summaryId: "chip", messages: initial, onClose: vi.fn() };
    const view = renderWithI18n(<FileChangesDialog {...props} />);
    const late: FileChange = { path: "C:/repo/main.php", before: "old", after: "new", source: "workspace" };
    const updated: ChatMessage[] = [...initial.slice(0, 1), { ...chip, changes: [change, late] },
      { id: "new-prompt", role: "user", content: "Manual prompt" },
      { id: "other-chip", kind: "file_changes", role: "agent", changes: [{ ...change, path: "C:/other/unrelated.ts" }] }];
    view.rerender(<FileChangesDialog {...props} messages={updated} />);
    const summary = fileSummaryFooters(updated, false).find((row) => row.kind === "file_changes");
    expect(summary?.kind === "file_changes" && summary.changes).toHaveLength(2);
    expect(document.querySelectorAll(".file-changes-item")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /unrelated.ts/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /main.php/ }));
    expect(document.querySelector(".file-changes-diff-file")?.textContent).toBe("main.php");
    expect([...document.querySelectorAll(".file-changes-diff-line")].map((line) => line.textContent)).toEqual(["-old", "+new"]);
    view.rerender(<FileChangesDialog {...props} messages={[]} />);
    expect(document.querySelectorAll(".file-changes-item")).toHaveLength(1);
    expect(document.querySelector(".file-changes-diff-file")?.textContent).toBe("long path.ts");
  });
  it("labels workspace-only evidence without calling unavailable binary content deleted", () => {
    const binary: FileChange = { path: "C:/repo/data.bin", before: null, after: null, beforeKnown: false, afterKnown: false, source: "workspace" };
    const view = renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={[messages[0], { id: "workspace", kind: "file_changes", role: "agent", changes: [binary] }]} onClose={vi.fn()} />);
    selectPrompt("Manual prompt");
    expect(screen.getByText("Workspace change")).toBeInTheDocument();
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
    view.unmount();
    renderWithI18n(<FileChangesDialog changes={[binary]} onClose={vi.fn()} />);
    expect(screen.getAllByText(/Workspace change/)).toHaveLength(2);
    expect(screen.getAllByText("Changed — snapshot unavailable")).toHaveLength(2);
  });

  it("shows Prompt, Model answer, and Files as matching collapsed disclosures", () => {
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={[...messages, { id: "answer", role: "agent", content: "Short answer" }]} onClose={vi.fn()} />);
    const list = within(screen.getByRole("navigation", { name: "File change history" }));
    fireEvent.click(list.getByRole("button", { name: /Manual prompt/ }));
    const detail = screen.getByRole("region", { name: "Manual prompt" });
    const sections = [...detail.querySelectorAll<HTMLDetailsElement>("details.file-change-history-section")];
    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.querySelector("summary")?.textContent?.trim())).toEqual(["Prompt", "Model answer", "Files1 file changed"]);
    expect(sections.every((section) => !section.open)).toBe(true);
    fireEvent.click(sections[0].querySelector("summary")!);
    expect(within(sections[0]).getByText("Manual prompt")).toBeInTheDocument();
    fireEvent.click(sections[1].querySelector("summary")!);
    expect(within(sections[1]).getByText("Short answer")).toBeInTheDocument();
    fireEvent.click(sections[2].querySelector("summary")!);
    expect(within(sections[2]).getByRole("button", { name: change.path })).toBeInTheDocument();
  });

  it("shows a fallback inside Model answer when no answer was recorded", () => {
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={messages} onClose={vi.fn()} />);
    const list = within(screen.getByRole("navigation", { name: "File change history" }));
    fireEvent.click(list.getByRole("button", { name: /Manual prompt/ }));
    const detail = screen.getByRole("region", { name: "Manual prompt" });
    fireEvent.click(historySection(detail, "Model answer").querySelector("summary")!);
    expect(within(detail).getByText("No model answer recorded.")).toBeInTheDocument();
  });

  it("renders the original prompt, not Knowledge envelope metadata", async () => {
    window.hermesAPI = {
      getSessionMessages: vi.fn().mockResolvedValue([
        { kind: "user", id: 1, content: encodeKnowledgePrompt("Exact user prompt", "PRIVATE INDEX") },
        { kind: "assistant", id: 2, content: "done", fileChanges: [change] },
      ]),
    } as unknown as typeof window.hermesAPI;
    renderWithI18n(
      <FileChangeHistoryDialog sessionId="session" messages={[]} onClose={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: /Exact user prompt/ })).toBeInTheDocument();
    expect(screen.queryByText(/Hermes One Knowledge envelope/)).toBeNull();
    expect(screen.queryByText("PRIVATE INDEX")).toBeNull();
  });

  it("decodes a live Knowledge envelope before it enters history", () => {
    renderWithI18n(
      <FileChangeHistoryDialog
        sessionId={null}
        messages={[
          { id: "live", role: "user", content: "Exact live prompt" },
          { id: "envelope", role: "user", content: encodeKnowledgePrompt("Envelope prompt", "PRIVATE INDEX") },
          { id: "change", kind: "file_changes", role: "agent", changes: [change] },
        ]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Envelope prompt/ })).toBeInTheDocument();
    expect(screen.queryByText(/Hermes One Knowledge envelope/)).toBeNull();
    expect(screen.queryByText("PRIVATE INDEX")).toBeNull();
  });

  it("discloses DB answers per prompt and updates finalized live answers without exposing tools", async () => {
    window.hermesAPI = { getSessionMessages: vi.fn().mockResolvedValue([
      { kind: "user", id: 1, content: "Older prompt" },
      { kind: "assistant", id: 2, content: "**Older answer**", fileChanges: [change] },
      { kind: "user", id: 3, content: "Manual prompt" },
      { kind: "assistant", id: 4, content: "**Stored answer**", fileChanges: [change] },
    ]) } as unknown as typeof window.hermesAPI;
    const props = { sessionId: "session", messages, onClose: vi.fn() };
    const view = renderWithI18n(<FileChangeHistoryDialog {...props} />);
    await screen.findByText("Older prompt");
    expect(screen.queryByText("Older answer")).toBeNull();
    const current = screen.getByRole("region", { name: "Manual prompt" });
    const answer = historySection(current, "Model answer");
    fireEvent.click(answer.querySelector("summary")!);
    fireEvent.click(historySection(current, "Files").querySelector("summary")!);
    expect(await screen.findByText("Stored answer")).toHaveProperty("tagName", "STRONG");
    const live: ChatMessage[] = [...messages,
      { id: "tool", kind: "tool_result", role: "agent", name: "patch", callId: "edit", content: "private tool result" },
      { id: "reason", kind: "reasoning", role: "agent", text: "private reasoning" },
      { id: "answer", role: "agent", pending: true, content: "**Live answer**" }];
    view.rerender(<FileChangeHistoryDialog {...props} messages={live} />);
    expect(screen.queryByText("Live answer")).toBeNull();
    view.rerender(<FileChangeHistoryDialog {...props} messages={live.map((row) => row.id === "answer" ? { ...row, pending: false } as ChatMessage : row)} />);
    expect(await screen.findByText("Live answer")).toHaveProperty("tagName", "STRONG");
    expect(screen.queryByText("Stored answer")).toBeNull();
    expect(screen.queryByText("private tool result")).toBeNull();
    expect(screen.queryByText("private reasoning")).toBeNull();
    selectPrompt("Older prompt");
    const older = screen.getByRole("region", { name: "Older prompt" });
    fireEvent.click(historySection(older, "Model answer").querySelector("summary")!);
    expect(await screen.findByText("Older answer")).toBeTruthy();
    expect(window.hermesAPI.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(within(older).getByRole("button", { name: change.path })).toBeInTheDocument();
  });
  it("history opens the exact same file/turn diff as the real chat chip despite path-only live edits", async () => {
    const chip = { id: "chip", kind: "file_changes" as const, role: "agent" as const, changes: [change] };
    const onOpen = vi.fn();
    renderWithI18n(<FileChangesRow msg={chip} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(chip.changes, chip.id);
    cleanup();
    renderWithI18n(<FileChangesDialog changes={onOpen.mock.calls[0][0]} onClose={vi.fn()} />);
    const chipDiff = [...document.querySelectorAll(".file-changes-diff-line")].map((line) => line.textContent);
    expect(chipDiff).toEqual(["-a", "+b"]);
    cleanup();
    window.hermesAPI = { getSessionMessages: vi.fn().mockResolvedValue([
      { kind: "user", id: 1, content: "Manual prompt" },
      { kind: "assistant", id: 2, content: "done", fileChanges: chip.changes },
    ]) } as unknown as typeof window.hermesAPI;
    const live: ChatMessage[] = [messages[0],
      { id: "call", kind: "tool_call", role: "agent", name: "patch", callId: "edit", args: JSON.stringify({ path: change.path }) },
      { id: "result", kind: "tool_result", role: "agent", name: "patch", callId: "edit", content: "{}" },
    ];
    renderWithI18n(<FileChangeHistoryDialog sessionId="session" messages={live} onClose={vi.fn()} />);
    await waitFor(() => expect(window.hermesAPI.getSessionMessages).toHaveBeenCalled());
    selectPrompt("Manual prompt");
    fireEvent.click(screen.getByRole("button", { name: change.path }));
    expect([...document.querySelectorAll(".file-changes-diff-line")].map((line) => line.textContent)).toEqual(chipDiff);
  });
  it.each([
    ["src/../src/a.ts", "C:\\repo", "C:/repo/src/a.ts", "C:/repo/src"],
    ["D:\\other\\a.ts", "C:/repo", "D:/other/a.ts", "D:/other"],
    ["../a.ts", "/repo/src", "/repo/a.ts", "/repo"],
    ["C:/a.ts", undefined, "C:/a.ts", "C:/"],
    ["/a.ts", undefined, "/a.ts", "/"],
    ["\\\\server\\share\\a.ts", undefined, "//server/share/a.ts", "//server/share/"],
  ])("resolves %s without changing its source", (path, cwd, resolved, folder) => {
    expect(resolveHistoryExplorerTarget(path, cwd)).toEqual({ path: resolved, folder });
  });
  it("keeps themed responsive list and summary padding", () => {
    const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
    const dialog = css.match(/\.file-change-history-dialog\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(dialog).toContain("width: 100vw");
    expect(dialog).toContain("height: 100dvh");
    expect(dialog).toContain("background: var(--bg-secondary)");
    expect(dialog).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    expect(css).toMatch(/\.file-change-history-layout\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 30%\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.file-change-history-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.file-change-history-turn\.is-active\s*\{[^}]*background:\s*var\(--bg-primary\)/);
    expect(css).toMatch(/\.file-change-history-section\s*\{[^}]*flex-shrink:\s*0/);
  });
  it.each(["Escape", "close", "backdrop"])("closes real Explorer only via %s, preserves selected history", async (method) => {
    window.hermesAPI = {
      readDirectory: vi.fn().mockResolvedValue([{ name: "long path.ts", isDirectory: false }]),
      watchContextFolder: vi.fn().mockResolvedValue(undefined),
      onContextFolderChanged: vi.fn().mockReturnValue(() => {}),
    } as unknown as typeof window.hermesAPI;
    const onClose = vi.fn();
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={messages} cwd="C:/repo" onClose={onClose} />);
    selectPrompt("Manual prompt");
    const parent = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: `Show file explorer: ${change.path}` }));
    const child = screen.getByRole("dialog", { name: "Show file explorer" });
    await waitFor(() => expect(child.querySelector(".worktree-row.is-selected")).not.toBeNull());
    expect(Number(child.style.zIndex)).toBeGreaterThan(Number(parent.style.zIndex));
    if (method === "Escape") fireEvent.keyDown(child, { key: "Escape" });
    else if (method === "close") fireEvent.click(child.querySelector("button[aria-label='Close']")!);
    else {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const overlay = document.querySelectorAll(".app-modal-overlay")[1];
      fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
      fireEvent.pointerUp(overlay, { button: 0, pointerType: "mouse" });
      fireEvent.click(overlay);
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Show file explorer" })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(parent).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Manual prompt" })).toBeInTheDocument();
  });
  it.each([[], null, "reject"])("missing/deleted file opens folder with no fabricated selection (%s)", async (result) => {
    window.hermesAPI = {
      readDirectory: result === "reject" ? vi.fn().mockRejectedValue(new Error("missing")) : vi.fn().mockResolvedValue(result),
      watchContextFolder: vi.fn().mockResolvedValue(undefined),
      onContextFolderChanged: vi.fn().mockReturnValue(() => {}),
    } as unknown as typeof window.hermesAPI;
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={messages} cwd="C:/repo" onClose={vi.fn()} />);
    selectPrompt("Manual prompt");
    fireEvent.click(screen.getByRole("button", { name: `Show file explorer: ${change.path}` }));
    const child = screen.getByRole("dialog", { name: "Show file explorer" });
    await waitFor(() => expect(child.querySelector(".worktree-error")).not.toBeNull());
    expect(child.querySelector(".is-selected")).toBeNull();
    expect(window.hermesAPI.readDirectory).toHaveBeenCalledWith("C:/repo/src");
  });
  it.each(["Escape", "close", "backdrop"])(
    "closes only nested diff via %s; parent preserves selected history",
    async (method) => {
      const onClose = vi.fn();
      renderWithI18n(
        <FileChangeHistoryDialog
          sessionId={null}
          messages={messages}
          onClose={onClose}
        />,
      );
      selectPrompt("Manual prompt");
      const parent = screen.getByRole("dialog");
      expect(parent).toHaveClass(
        "app-modal-content",
        "file-change-history-dialog",
      );
      expect(Number(parent.style.zIndex)).toBeGreaterThan(1002);
      expect(parent.parentElement).toBe(document.body);
      fireEvent.click(screen.getByRole("button", { name: change.path }));
      const child = screen.getByRole("dialog", { name: "File changes" });
      expect(Number(child.style.zIndex)).toBeGreaterThan(
        Number(parent.style.zIndex),
      );
      if (method === "Escape") fireEvent.keyDown(child, { key: "Escape" });
      else if (method === "close")
        fireEvent.click(child.querySelector("button[aria-label='Close']")!);
      else {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const overlay = document.querySelectorAll(".app-modal-overlay")[1];
        fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
        fireEvent.pointerUp(overlay, { button: 0, pointerType: "mouse" });
        fireEvent.click(overlay);
      }
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "File changes" }),
        ).not.toBeInTheDocument(),
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(parent).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Manual prompt" })).toBeInTheDocument();
    },
  );
  it("copies the original path; explorer selects and scrolls the resolved file", async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
    readDirectory.mockResolvedValue([{ name: "long path.ts", isDirectory: false }]);
    window.hermesAPI = {
      copyToClipboard,
      readDirectory,
      watchContextFolder: vi.fn().mockResolvedValue(undefined),
      onContextFolderChanged: vi.fn().mockReturnValue(() => {}),
    } as unknown as typeof window.hermesAPI;
    const onOpenExplorer = vi.fn();
    renderWithI18n(
      <FileChangeHistoryDialog
        sessionId={null}
        messages={messages}
        onClose={vi.fn()}
        cwd="C:/repo"
        onOpenExplorer={onOpenExplorer}
      />,
    );
    selectPrompt("Manual prompt");
    fireEvent.click(
      screen.getByRole("button", { name: `Copy path: ${change.path}` }),
    );
    await screen.findByText("Path copied.");
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(change.path);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Show file explorer: ${change.path}`,
      }),
    );
    expect(onOpenExplorer).toHaveBeenCalledExactlyOnceWith("C:/repo/src/long path.ts");
    await waitFor(() => expect(document.querySelector(".worktree-row.is-selected")).toHaveAttribute("title", "C:/repo/src/long path.ts"));
    expect(readDirectory).toHaveBeenCalledWith("C:/repo/src");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
  // @lat: [[file-changes#Copy current file content]]
  it.each([
    ["  unchanged\r\n\tcurrent content\n\n", "  unchanged\r\n\tcurrent content\n\n"],
    ["\ufeff  content\r\n\n", "  content\r\n\n"],
    ["\ufeff\ufeff\ufeff<?php\r\n", "<?php\r\n"],
    ["\ufeff\ufeff", ""],
    ["embedded\ufeffcontent\n", "embedded\ufeffcontent\n"],
    ["", ""],
  ])("copies full content without leading BOM characters (%j)", async (content, expected) => {
    let finishRead!: (value: { content: string; truncated: boolean }) => void;
    const readFile = vi.fn(() => new Promise<{ content: string; truncated: boolean }>((resolve) => { finishRead = resolve; }));
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    window.hermesAPI = { isRemoteMode: vi.fn().mockResolvedValue(false), readFile, copyToClipboard } as unknown as typeof window.hermesAPI;
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={messages} cwd="C:/repo" onClose={vi.fn()} />);
    selectPrompt("Manual prompt");
    const button = screen.getByRole("button", { name: `Copy content: ${change.path}` });
    expect(screen.getByRole("button", { name: `Copy path: ${change.path}` }).nextElementSibling).toBe(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Copying file content...");
    await waitFor(() => expect(readFile).toHaveBeenCalledExactlyOnceWith("C:/repo/src/long path.ts", Number.MAX_SAFE_INTEGER));
    expect(copyToClipboard).not.toHaveBeenCalled();
    finishRead({ content, truncated: false });
    await screen.findByText("File content copied.");
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(expected);
    expect(button).not.toBeDisabled();
  });
  it.each([
    ["missing", "Could not read the current file"],
    ["truncated", "The file read was incomplete"],
    ["binary", "binary or unsupported text"],
    ["invalid UTF-8", "binary or unsupported text"],
    ["read failure", "Could not copy file content"],
    ["clipboard failure", "Could not copy file content"],
    ["remote", "unavailable for remote files"],
    ["no cwd", "Attach a working folder"],
  ])("reports %s without silently copying partial/diff/path content", async (failure, feedback) => {
    const readFile = failure === "read failure" ? vi.fn().mockRejectedValue(new Error("denied")) : vi.fn().mockResolvedValue(
      failure === "missing" ? null : { content: failure === "binary" ? "text\u0000data" : failure === "invalid UTF-8" ? "text\ufffddata" : "whole file", truncated: failure === "truncated" },
    );
    const copyToClipboard = failure === "clipboard failure" ? vi.fn().mockRejectedValue(new Error("denied")) : vi.fn().mockResolvedValue(undefined);
    window.hermesAPI = { isRemoteMode: vi.fn().mockResolvedValue(failure === "remote"), readFile, copyToClipboard } as unknown as typeof window.hermesAPI;
    renderWithI18n(<FileChangeHistoryDialog sessionId={null} messages={messages} cwd={failure === "no cwd" ? undefined : "C:/repo"} onClose={vi.fn()} />);
    selectPrompt("Manual prompt");
    const button = screen.getByRole("button", { name: `Copy content: ${change.path}` });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(feedback));
    expect(screen.queryByText("File content copied.")).not.toBeInTheDocument();
    if (failure === "clipboard failure") expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith("whole file");
    else expect(copyToClipboard).not.toHaveBeenCalled();
    if (failure === "remote" || failure === "no cwd") expect(readFile).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });
  it("does not open unresolved relative paths without cwd", () => {
    renderWithI18n(
      <FileChangeHistoryDialog
        sessionId={null}
        messages={messages}
        onClose={vi.fn()}
        onOpenExplorer={vi.fn()}
      />,
    );
    selectPrompt("Manual prompt");
    expect(
      screen.getByRole("button", {
        name: `Show file explorer: ${change.path}`,
      }),
    ).toBeDisabled();
  });
  it("loads old history once, selects a turn, and opens its file view", async () => {
    const getSessionMessages = vi.fn().mockResolvedValue([
      { kind: "user", id: 1, content: "Older prompt" },
      { kind: "assistant", id: 2, content: "done", fileChanges: [change] },
    ]);
    window.hermesAPI = {
      getSessionMessages,
    } as unknown as typeof window.hermesAPI;
    const onOpenFileChanges = vi.fn();
    const props = {
      sessionId: "current",
      messages,
      onClose: vi.fn(),
      onOpenFileChanges,
    };
    const view = renderWithI18n(<FileChangeHistoryDialog {...props} />);
    await screen.findByText("Older prompt");
    expect(getSessionMessages).toHaveBeenCalledExactlyOnceWith("current");
    selectPrompt("Older prompt");
    expect(screen.getByRole("region", { name: "Older prompt" })).toBeInTheDocument();
    selectPrompt("Manual prompt");
    const details = screen.getByRole("region", { name: "Manual prompt" });
    fireEvent.click(details.querySelector(".file-change-history-path")!);
    expect(onOpenFileChanges).toHaveBeenCalledWith([change]);
    view.rerender(
      <FileChangeHistoryDialog {...props} messages={[...messages]} />,
    );
    expect(getSessionMessages).toHaveBeenCalledTimes(1);
  });
  it("shows loading, error and retry instead of silently presenting partial history", async () => {
    const getSessionMessages = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    window.hermesAPI = {
      getSessionMessages,
    } as unknown as typeof window.hermesAPI;
    renderWithI18n(
      <FileChangeHistoryDialog
        sessionId="current"
        messages={[]}
        onClose={vi.fn()}
        onOpenFileChanges={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No recorded file changes in this session.");
    expect(getSessionMessages).toHaveBeenCalledTimes(2);
  });
  it("handles draft empty state and Escape close without IPC", async () => {
    const getSessionMessages = vi.fn();
    window.hermesAPI = {
      getSessionMessages,
    } as unknown as typeof window.hermesAPI;
    const onClose = vi.fn();
    renderWithI18n(
      <FileChangeHistoryDialog
        sessionId={null}
        messages={[]}
        onClose={onClose}
        onOpenFileChanges={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No recorded file changes in this session."),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(getSessionMessages).not.toHaveBeenCalled();
  });
});
