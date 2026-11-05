import { afterEach, expect, it, vi } from "vitest";
import type { SessionHistoryPage, SessionHistoryRow } from "../../../../shared/session-history";
import { ChildFileChangeCollector, childToolChanges } from "./childFileChanges";

const owner = { sessionId: "parent", promptId: "prompt-1" };
const call = (id = 1, callId = "edit", before = "old", after = "new"): SessionHistoryRow => ({
  kind: "tool_call", id, callId, name: "functions.patch",
  args: JSON.stringify({ path: "C:/repo/a.ts", old_string: before, new_string: after }),
});
const result = (id = 2, callId = "edit"): SessionHistoryRow => ({
  kind: "tool_result", id, callId, name: "patch", content: JSON.stringify({ success: true, files_modified: ["C:/repo/a.ts"] }),
});
const page = (items: SessionHistoryRow[], hasMore = false): SessionHistoryPage => ({
  items, hasMore, oldestId: items.length ? Math.min(...items.map((row) => row.id)) : null,
  newestId: items.length ? Math.max(...items.map((row) => row.id)) : null,
});
const start = { type: "subagent.start", session_id: "runtime", payload: { subagent_id: "child", child_session_id: "child-session" } };

afterEach(() => { vi.useRealTimers(); });

it("accepts actual edit results, rejects failures, progress mirrors, stdout and relative paths", () => {
  expect(childToolChanges(call(), result())).toMatchObject([{ path: "C:/repo/a.ts", before: "old", after: "new", beforeKnown: false }]);
  expect(childToolChanges(call(), { ...result(), content: '{"success":false,"error":"no match"}' })).toEqual([]);
  expect(childToolChanges({ ...call(), name: "execute_code" }, result())).toEqual([]);
  expect(childToolChanges(call(1, "submirror:fake"), result(2, "submirror:fake"))).toEqual([]);
  expect(childToolChanges({ ...call(), args: '{"path":"a.ts"}' }, { ...result(), content: "{}" })).toEqual([]);
  expect(childToolChanges(call(), { ...result(), callId: "different" })).toEqual([]);
  expect(childToolChanges(call(), { ...result(), content: "Tool started, no result yet" })).toEqual([]);
});

it("pairs across pages, publishes chronologically, retains spawn ownership across later prompts", async () => {
  vi.useFakeTimers();
  const read = vi.fn()
    .mockResolvedValueOnce(page([result(4, "second"), call(3, "second", "middle", "latest")], true))
    .mockResolvedValueOnce(page([call(1, "first", "earliest", "middle"), result(2, "first")]))
    .mockResolvedValue(page([call(3, "second", "middle", "latest"), result(4, "second")]));
  const publish = vi.fn();
  const collector = new ChildFileChangeCollector(read, publish);
  collector.event(start, "runtime", owner);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).not.toHaveBeenCalled();
  collector.event({ ...start, type: "subagent.complete" }, "runtime", { ...owner, promptId: "prompt-2" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenNthCalledWith(2, "child-session", 3, 100);
  expect(publish).toHaveBeenCalledExactlyOnceWith(owner, [expect.objectContaining({ before: "earliest", after: "latest" })]);
  await vi.advanceTimersByTimeAsync(6000);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(4);
  collector.dispose();
});

it("pairs an edit split across a page boundary and handles more than 100 rows", async () => {
  vi.useFakeTimers();
  const filler = Array.from({ length: 100 }, (_, index): SessionHistoryRow => ({
    id: index + 2, kind: "assistant", content: "progress",
  }));
  const read = vi.fn().mockResolvedValueOnce(page([...filler, result(102)], true))
    .mockResolvedValue(page([call()]));
  const publish = vi.fn();
  const collector = new ChildFileChangeCollector(read, publish);
  collector.event(start, "runtime", owner);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenNthCalledWith(2, "child-session", 2, 100);
  expect(publish).toHaveBeenCalledExactlyOnceWith(owner, [expect.objectContaining({ before: "old", after: "new" })]);
  collector.dispose();
});

it("keeps an unmatched call across polls and ignores unrelated parent sessions", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(page([call()])).mockResolvedValue(page([call(), result()]));
  const publish = vi.fn();
  const collector = new ChildFileChangeCollector(read, publish);
  collector.event({ ...start, session_id: "unrelated" }, "runtime", owner);
  expect(read).not.toHaveBeenCalled();
  collector.event(start, "runtime", owner);
  await vi.advanceTimersByTimeAsync(2000);
  expect(publish).toHaveBeenCalledExactlyOnceWith(owner, [expect.objectContaining({ path: "C:/repo/a.ts" })]);
  collector.dispose();
  await vi.advanceTimersByTimeAsync(4000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("rejects a late response after disposal and retries transient reads", async () => {
  vi.useFakeTimers();
  let release!: (value: SessionHistoryPage) => void;
  const read = vi.fn().mockRejectedValueOnce(new Error("lagging DB"))
    .mockImplementationOnce(() => new Promise<SessionHistoryPage>((resolve) => { release = resolve; }));
  const publish = vi.fn();
  const collector = new ChildFileChangeCollector(read, publish);
  collector.event(start, "runtime", owner);
  await vi.advanceTimersByTimeAsync(2000);
  collector.dispose();
  release(page([call(), result()]));
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).not.toHaveBeenCalled();
});
