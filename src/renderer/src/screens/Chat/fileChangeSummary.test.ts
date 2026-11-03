import { expect, it } from "vitest";
import { fileSummaryFooters, mergePromptFileChanges, updatePromptFileSummary } from "./fileChangeSummary";
import type { ChatMessage, FileChange } from "./types";

const change = (path: string, before: string | null, after: string | null): FileChange => ({ path, before, after, beforeKnown: true });
const prompt: ChatMessage = { id: "u1", role: "user", content: "edit files" };
const first: ChatMessage = { id: "answer1", role: "agent", content: "interim" };
const last: ChatMessage = { id: "answer2", role: "agent", content: "finished" };

it("upserts one stable chip per manual prompt, preserving the earliest baseline and latest result", () => {
  const initial = updatePromptFileSummary([prompt, first], [change("C:/repo/a.ts", "before", "middle")]);
  const chipId = initial.at(-1)!.id;
  const resumed: ChatMessage[] = [...initial, { id: "notice", role: "user", content: "[System: continue]" }, last];
  const final = updatePromptFileSummary(resumed, [change("c:\\repo\\a.ts", "middle", "after"), change("C:/repo/b.ts", null, "created")]);
  const chips = final.filter((row) => row.kind === "file_changes");
  expect(chips).toHaveLength(1);
  expect(chips[0]).toMatchObject({ id: chipId, changes: [change("C:/repo/a.ts", "before", "after"), change("C:/repo/b.ts", null, "created")] });
  const next = updatePromptFileSummary([...final, { ...prompt, id: "u2" }], [change("C:/repo/a.ts", "after", "new turn")]);
  expect(next.filter((row) => row.kind === "file_changes")).toHaveLength(2);
});

it("keeps creation/deletion and empty-file baselines distinct from unknown snapshots", () => {
  expect(mergePromptFileChanges([change("a", null, "created")], [change("a", "created", null)])[0]).toMatchObject({ before: null, after: null, beforeKnown: true });
  expect(mergePromptFileChanges([change("a", "", "middle")], [change("a", "middle", "after")])[0].before).toBe("");
});

it("moves chips to the prompt footer, hides only the active footer, and leaves source history untouched", () => {
  const a = change("a", "before", "middle");
  const b = change("a", "middle", "after");
  const messages: ChatMessage[] = [prompt, first, { id: "fc1", kind: "file_changes", role: "agent", changes: [a] },
    { id: "notice", role: "user", content: "[System: continue]" }, last,
    { id: "fc2", kind: "file_changes", role: "agent", changes: [b] }];
  const settled = fileSummaryFooters(messages, false);
  expect(settled.map((row) => row.id)).toEqual(["u1", "answer1", "notice", "answer2", "fc1"]);
  expect(settled.at(-1)).toMatchObject({ changes: [change("a", "before", "after")] });
  expect(fileSummaryFooters(messages, true).some((row) => row.kind === "file_changes")).toBe(false);
  const next: ChatMessage[] = [...messages, { ...prompt, id: "u2" }, last];
  expect(fileSummaryFooters(next, true).filter((row) => row.kind === "file_changes")).toHaveLength(1);
  expect(messages.filter((row) => row.kind === "file_changes")).toHaveLength(2);
});

it("normalizes reopened assistant overlays to one footer, not tool-result snapshots mid-stream", () => {
  const messages: ChatMessage[] = [prompt, { ...first, fileChanges: [change("a", "before", "after")] },
    { id: "tool", role: "agent", kind: "tool_result", name: "patch", callId: "t", content: "ok", fileChanges: [change("b", null, "new")] }, last];
  expect(fileSummaryFooters(messages, false).at(-1)).toMatchObject({ kind: "file_changes", changes: [change("a", "before", "after")] });
});
