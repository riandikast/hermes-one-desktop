import { describe, expect, it } from "vitest";
import {
  countDiffLineStats,
  filePathFromInlineDiff,
  parseDiff,
  parseHunks,
  stripDiffChrome,
} from "./diffLines";

const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 123..456 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,5 +10,6 @@ export function run() {",
  "  const x = 1;",
  "-  return x;",
  "+  return x + 1;",
  "+  console.log(x);",
  " }",
].join("\n");

describe("diffLines — official unified-diff primitives", () => {
  it("counts +/− lines, excluding headers", () => {
    expect(countDiffLineStats(SAMPLE_DIFF)).toEqual({ added: 2, removed: 1 });
  });

  it("returns 0/0 for a diff with no hunks", () => {
    expect(countDiffLineStats("diff --git a/x b/x\nindex 1..2\n")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("parses hunks with old/new ranges", () => {
    const hunks = parseHunks(SAMPLE_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 10, oldLines: 5, newStart: 10, newLines: 6 });
  });

  it("parses diff lines with kinds", () => {
    const lines = parseDiff(SAMPLE_DIFF);
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(2);
    expect(lines.filter((l) => l.kind === "remove")).toHaveLength(1);
    expect(lines.filter((l) => l.kind === "context")).toHaveLength(2);
  });

  it("strips ANSI codes and the Hermes ┊ review diff marker", () => {
    const dirty = "\u001b[32m  ┊ review diff\u001b[0m\n\u001b[31m- old\u001b[0m\n+ new";
    expect(stripDiffChrome(dirty)).toBe("- old\n+ new");
  });

  it("extracts the file path from ---/+++ and the arrow form", () => {
    expect(filePathFromInlineDiff(SAMPLE_DIFF)).toBe("src/a.ts");
    const arrow = "a/src/a.ts → b/src/a.ts\n@@ -1 +1 @@\n-x\n+y";
    expect(filePathFromInlineDiff(arrow)).toBe("src/a.ts");
  });

  it("returns null path for a headerless diff", () => {
    expect(filePathFromInlineDiff("@@ -1 +1 @@\n-x\n+y")).toBeNull();
  });
});
