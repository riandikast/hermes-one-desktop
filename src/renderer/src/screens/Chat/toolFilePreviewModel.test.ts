import { expect, it } from "vitest";
import { applyDashboardStreamEvent } from "./dashboardEventAdapter";
import {
  filePreviewText,
  latestFileTool,
  previewEditRange,
  FILE_PREVIEW_LIMIT,
} from "./toolFilePreviewModel";
import type { ChatMessage, ToolCallMessage } from "./types";

const tool = (
  args: Record<string, unknown>,
  name = "patch",
): ToolCallMessage => ({
  id: "t",
  kind: "tool_call",
  role: "agent",
  callId: "t",
  name,
  args: JSON.stringify(args),
  status: "running",
});

it("keeps structured file arguments when a friendly tool label overrides displayed args", () => {
  const args = {
    path: "C:/repo/a.ts",
    old_string: "before",
    new_string: "after",
  };
  let state = applyDashboardStreamEvent(
    { messages: [], reasoningSegmentClosed: false },
    {
      type: "tool.start",
      payload: { tool_id: "t", name: "patch", context: "Fixing file", args },
    },
  );
  expect(state.messages[0]).toMatchObject({
    args: "Fixing file",
    filePreviewArgs: JSON.stringify(args),
  });
  state = applyDashboardStreamEvent(state, {
    type: "tool.complete",
    payload: { tool_id: "t", name: "patch", result: "ok" },
  });
  expect(latestFileTool(state.messages)).toMatchObject({
    path: args.path,
    operation: "Patch",
    status: "completed",
    args,
  });
});

it("scopes previews to the current manual request and explicit file tools only", () => {
  const file = tool({ path: "src/a.ts" });
  expect(latestFileTool([file], "C:/repo")?.path).toBe("C:/repo/src/a.ts");
  expect(
    latestFileTool([
      file,
      { id: "notice", role: "user", content: "[System: continue]" },
    ]),
  ).not.toBeNull();
  expect(
    latestFileTool([file, { id: "next", role: "user", content: "new prompt" }]),
  ).toBeNull();
  expect(
    latestFileTool([tool({ command: "cat C:/repo/a.ts" }, "terminal")]),
  ).toBeNull();
  expect(
    latestFileTool([
      tool(
        { path: "C:/repo/a.ts", content: "a".repeat(FILE_PREVIEW_LIMIT * 4) },
        "write_file",
      ),
    ]),
  ).toBeNull();
  expect(
    latestFileTool(
      [
        tool({
          patch:
            "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
        }),
      ],
      "C:/repo",
    )?.path,
  ).toBe("C:/repo/src/a.ts");
});

it("replays exact replacement without interpreting dollar signs, labels ambiguous hunks, prefers observed after-content", () => {
  const file = latestFileTool([
    tool({ path: "a.ts", old_string: "old", new_string: "$& new" }),
  ])!;
  expect(filePreviewText(file, "line old tail")).toEqual({
    before: "line old tail",
    after: "line $& new tail",
    excerpt: false,
  });
  expect(filePreviewText(file, "old old")).toEqual({
    before: "old",
    after: "$& new",
    excerpt: true,
  });
  expect(
    filePreviewText(
      { ...file, args: { ...file.args, replace_all: true } },
      "old old",
    ).after,
  ).toBe("$& new $& new");
  expect(filePreviewText(file, "old", "actual disk")).toEqual({
    before: "old",
    after: "actual disk",
    excerpt: false,
  });
  expect(filePreviewText({ ...file, status: "failed" }, "original").after).toBe(
    "original",
  );
  expect(
    filePreviewText({ ...file, operation: "Read" }, "read content").after,
  ).toBe("read content");
});

it("bounds one replacement range including empty input, deletion and surrogate pairs", () => {
  for (const [before, after] of [
    ["before\nold\ntail", "before\nnew\ntail"],
    ["", "new"],
    ["old", ""],
    ["a😀z", "a😁z"],
    ["same", "same"],
  ]) {
    const edit = previewEditRange(before, after);
    expect(
      before.slice(0, edit.from) + edit.insert + before.slice(edit.to),
    ).toBe(after);
    expect(/[\uD800-\uDBFF]$/.test(before.slice(0, edit.from))).toBe(false);
  }
});

it("does not mutate source history while finding a candidate", () => {
  const messages: ChatMessage[] = [
    tool({ path: "a.ts", content: "hello" }, "write_file"),
  ];
  const original = JSON.stringify(messages);
  expect(latestFileTool(messages)?.operation).toBe("Write");
  expect(JSON.stringify(messages)).toBe(original);
});
