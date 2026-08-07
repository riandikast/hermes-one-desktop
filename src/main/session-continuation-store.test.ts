import { describe, expect, it } from "vitest";
import { normalizeFileChangesWithDiff } from "./session-continuation-store";

describe("session-continuation-store — diff field", () => {
  it("normalizeFileChangesWithDiff keeps the diff string on records", () => {
    const raw = [
      { path: "a.ts", before: null, after: "x", diff: "@@ -1 +1 @@\n+x" },
      { path: "b.ts", before: null, after: "y" },
    ];
    const out = normalizeFileChangesWithDiff(raw);
    expect(out[0].diff).toBe("@@ -1 +1 @@\n+x");
    expect(out[1].diff).toBeUndefined();
  });

  it("drops non-record entries and non-string diffs", () => {
    const out = normalizeFileChangesWithDiff([
      null,
      "x",
      { path: "a.ts" },
      { path: "b.ts", diff: 42 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("a.ts");
  });
});
