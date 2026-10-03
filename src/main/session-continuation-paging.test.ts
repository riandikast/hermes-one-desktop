// Overlay placement when history is read one page at a time.
//
// A long session opens on its newest page instead of the whole transcript, so
// session-level overlays (local errors, the file-change chip, the continuation
// prefix) must be scoped to the page that owns them. Getting this wrong either
// duplicates an overlay or pins an old error to the bottom of the window.

import { describe, expect, it } from "vitest";
import { mergeSessionLocalErrors } from "./session-continuation-store";
import type { HistoryItem } from "./sessions";

const user = (id: number, content: string): HistoryItem => ({
  kind: "user",
  id,
  content,
  timestamp: id,
});

describe("mergeSessionLocalErrors with appendUnmatched=false", () => {
  it("drops an error whose prompt is not in this page", () => {
    // The error belongs to prompt "old", which lives on an unloaded page.
    const page = [user(50, "new question")];
    const merged = mergeSessionLocalErrors(
      page,
      [{ userContent: "old question", error: "boom" }],
      { appendUnmatched: false },
    );
    // Not pinned to the bottom of the visible window.
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe("user");
  });

  it("still attaches an error whose prompt IS in this page", () => {
    const page = [user(50, "new question")];
    const merged = mergeSessionLocalErrors(
      page,
      [{ userContent: "new question", error: "boom" }],
      { appendUnmatched: false },
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      kind: "assistant",
      error: "boom",
      content: "",
    });
  });

  it("does not replay unmatched historical errors after a refresh", () => {
    const merged = mergeSessionLocalErrors(
      [user(1, "a")],
      [{ userContent: "elsewhere", error: "boom" }],
    );
    expect(merged).toEqual([user(1, "a")]);
  });
});
