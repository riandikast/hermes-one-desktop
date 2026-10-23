import { describe, expect, it, vi } from "vitest";
import {
  groupFileChangeHistory,
  loadFileChangeHistory,
  mergeFileChangeHistory,
} from "./fileChangeHistory";
import type { ChatMessage, FileChange } from "./types";
import chatSource from "./Chat.tsx?raw";

const change: FileChange = {
  path: "C:\\Repo\\Exact.ts",
  before: "old",
  after: "new",
};
const user = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
});
const edits = (id: string, path: string): ChatMessage[] => [
  {
    id: `${id}-call`,
    kind: "tool_call",
    role: "agent",
    callId: id,
    name: "patch",
    args: JSON.stringify({ path }),
  },
  {
    id: `${id}-result`,
    kind: "tool_result",
    role: "agent",
    callId: id,
    name: "patch",
    content: "{}",
  },
];
describe("file change history", () => {
  // @lat: [[file-changes#Per-prompt model answer]]
  it("keeps only each manual turn's final answer, not progress, tools, reasoning or notices", () => {
    const turns = groupFileChangeHistory([
      user("one", "First prompt"),
      { id: "progress", role: "agent", content: "Working on it" },
      ...edits("a", "a.ts"),
      { id: "thought", kind: "reasoning", role: "agent", text: "private reasoning" },
      user("internal", "[System: continue the interrupted task]"),
      { id: "final-one", kind: "assistant", role: "agent", content: "**First answer**" },
      { id: "notice", role: "agent", content: "[System: runtime notice]" },
      { id: "local", role: "agent", localOnly: true, content: "local notice" },
      { id: "loader", role: "agent", isSlashLoader: true, content: "Loading" },
      user("two", "Second prompt"),
      ...edits("b", "b.ts"),
      { id: "final-two", role: "agent", content: "Second answer" },
      { id: "error", role: "agent", error: "failure", content: "Error" },
    ]);
    expect(turns.map(({ prompt, answer }) => [prompt.id, answer])).toEqual([
      ["one", "**First answer**"], ["two", "Second answer"],
    ]);
    expect(groupFileChangeHistory([user("one", "First prompt"),
      { id: "progress", role: "agent", content: "Working on it" },
      ...edits("a", "a.ts"),
    ])[0].answer).toBeUndefined();
  });
  it("merges a finalized live answer without live file snapshots, preserving DB answers while pending", () => {
    const stored: ChatMessage[] = [user("db-1", "same"), ...edits("a", "a.ts"),
      { id: "a1", role: "agent", content: "Older answer" },
      user("db-2", "same"), ...edits("b", "b.ts"),
      { id: "a2", role: "agent", content: "Stored answer" }];
    const live: ChatMessage[] = [user("live", "same"),
      { id: "live-answer", role: "agent", content: "New answer", pending: true }];
    expect(mergeFileChangeHistory(stored, live).map((turn) => turn.answer)).toEqual(["Stored answer", "Older answer"]);
    expect(mergeFileChangeHistory(stored, [live[0], { ...live[1], pending: false } as ChatMessage])
      .map((turn) => turn.answer)).toEqual(["New answer", "Older answer"]);
    expect(mergeFileChangeHistory([], live)).toEqual([]);
    const storedWithoutSnapshots: ChatMessage[] = [user("db-only", "edit"),
      { id: "db-answer", role: "agent", content: "Persisted final answer" }];
    expect(mergeFileChangeHistory(storedWithoutSnapshots, [user("local-only", "edit"), ...edits("c", "c.ts")])[0].answer)
      .toBe("Persisted final answer");
  });
  it("groups manual prompts, keeps exact text and IDs, ignores injected delimiters", () => {
    const messages: ChatMessage[] = [
      ...edits("orphan", "orphan.ts"),
      user("first", "  Exact\n prompt  "),
      ...edits("a", "src/a.ts"),
      user("notice", "[IMPORTANT: background done]"),
      user("compact", "[CONTEXT COMPACTION summary]"),
      ...edits("b", "src/b.ts"),
      user("second", "[bug] real prompt"),
      ...edits("c", "src/c.ts"),
      {
        id: "failed",
        kind: "tool_call",
        role: "agent",
        callId: "fail",
        name: "write_file",
        args: '{"path":"fail.ts"}',
      },
      {
        id: "failed-result",
        kind: "tool_result",
        role: "agent",
        callId: "fail",
        name: "write_file",
        content: '{"error":"denied"}',
      },
    ];
    const turns = groupFileChangeHistory(messages);
    expect(turns.map((turn) => turn.prompt.id)).toEqual(["first", "second"]);
    expect(turns[0].prompt.content).toBe("  Exact\n prompt  ");
    expect(turns.map((turn) => turn.changes.map((c) => c.path))).toEqual([
      ["src/a.ts", "src/b.ts"],
      ["src/c.ts"],
    ]);
  });
  it("deduplicates chip/bubble snapshots and prefers captured contents over tool fallback", () => {
    const turns = groupFileChangeHistory([
      user("p", "edit"),
      ...edits("a", change.path),
      { id: "answer", role: "agent", content: "done", fileChanges: [change] },
      { id: "chip", kind: "file_changes", role: "agent", changes: [change] },
    ]);
    expect(turns[0].changes).toEqual([change]);
  });
  it("retains exact same-turn chip snapshot across poorer rows and stored/live merge", () => {
    const chip: ChatMessage = { id: "chip", kind: "file_changes", role: "agent", changes: [change] };
    const poor = { ...change, before: null, after: null, beforeKnown: false };
    const stored: ChatMessage[] = [user("db-1", "edit"), chip];
    const live: ChatMessage[] = [user("local", "edit"), ...edits("a", change.path)];
    expect(mergeFileChangeHistory(stored, live)[0].changes).toEqual(chip.changes);
    expect(groupFileChangeHistory([...stored, { id: "poor", role: "agent", content: "done", fileChanges: [poor] }])[0].changes).toEqual(chip.changes);
    expect(mergeFileChangeHistory(live, stored)[0].changes).toEqual(chip.changes);
  });
  it("merges newest first without collapsing repeated manual prompt IDs", () => {
    const stored = [
      user("db-1", "same"),
      ...edits("a", "a.ts"),
      user("db-2", "same"),
      ...edits("b", "b.ts"),
    ];
    const live: ChatMessage[] = [
      user("live-2", "same"),
      { id: "chip", kind: "file_changes", role: "agent", changes: [change] },
    ];
    const turns = mergeFileChangeHistory(stored, live);
    expect(turns.map((turn) => turn.prompt.id)).toEqual(["db-2", "db-1"]);
    expect(turns[0].changes.map((c) => c.path)).toEqual(["b.ts", change.path]);
  });
  it("requests full public history without a tail cursor and preserves raw prompt text", async () => {
    const getSessionMessages = vi.fn().mockResolvedValue([
      { kind: "user", id: 1, content: "  exact prompt  " },
      { kind: "assistant", id: 2, content: "done", fileChanges: [change] },
    ]);

    window.hermesAPI = {
      getSessionMessages,
    } as unknown as typeof window.hermesAPI;
    const messages = await loadFileChangeHistory("current-session");
    expect(getSessionMessages).toHaveBeenCalledExactlyOnceWith(
      "current-session",
    );
    expect(groupFileChangeHistory(messages)[0].prompt.content).toBe(
      "  exact prompt  ",
    );
    expect(groupFileChangeHistory(messages)[0].changes).toEqual([change]);
  });
  it("wires the new icon between explorer and terminal; dialog mounts lazily; deleted banner stays deleted", () => {
    expect(chatSource.length).toBeGreaterThan(1000);
    const explorer = chatSource.indexOf('aria-label="File explorer"');
    const history = chatSource.indexOf(
      'aria-label={t("chat.fileChangeHistory.title")}',
    );
    const terminal = chatSource.indexOf('aria-label="Terminal"');
    expect(explorer).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(explorer);
    expect(terminal).toBeGreaterThan(history);
    expect(chatSource).toMatch(
      /fileChangeHistoryOpen && \(\s*<FileChangeHistoryDialog/,
    );
    expect(chatSource).toContain("sessionId={hermesSessionId}");
    expect(chatSource).not.toContain('toolProgress || "Waiting on provider"');
  });
  it("includes every old turn beyond a recent message page", async () => {
    const items = Array.from({ length: 350 }, (_, i) => [
      { kind: "user", id: i * 2 + 1, content: `Prompt ${i}` },
      {
        kind: "assistant",
        id: i * 2 + 2,
        content: "done",
        fileChanges: [{ ...change, path: `src/${i}.ts` }],
      },
    ]).flat();
    window.hermesAPI = {
      getSessionMessages: vi.fn().mockResolvedValue(items),
    } as unknown as typeof window.hermesAPI;
    const turns = mergeFileChangeHistory(
      await loadFileChangeHistory("long"),
      [],
    );
    expect(turns).toHaveLength(350);
    expect(turns[0].prompt.content).toBe("Prompt 349");
    expect(turns[349].changes[0].path).toBe("src/0.ts");
  });
});
