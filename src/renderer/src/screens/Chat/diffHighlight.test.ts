import { describe, expect, it } from "vitest";
import {
  classifyDiffLine,
  diffLineBody,
  diffStat,
  renderDiffLines,
  tokenizeLine,
} from "./diffHighlight";

/** Concatenated token text must always equal the input (no dropped chars). */
function roundTrip(line: string): string {
  return tokenizeLine(line)
    .map((t) => t.text)
    .join("");
}

describe("tokenizeLine", () => {
  it("always reproduces the input exactly", () => {
    const samples = [
      "const x = 1;",
      'const s = "hello \\"world\\"";',
      "  // a comment",
      "# python comment",
      "foo(bar, baz);",
      "if (a && b) return null;",
      "",
      "  ",
      "const weird = 'unterminated",
      "obj.prop = arr[0] + 2.5e3;",
      "async function load(): Promise<Result> {}",
    ];
    for (const s of samples) expect(roundTrip(s)).toBe(s);
  });

  it("classifies keywords, strings, and numbers", () => {
    const toks = tokenizeLine("const n = 42; // note");
    expect(toks.find((t) => t.text === "const")?.kind).toBe("keyword");
    expect(toks.find((t) => t.text === "42")?.kind).toBe("number");
    expect(toks.find((t) => t.kind === "comment")?.text).toBe("// note");
  });

  it("treats a quoted run as one string token", () => {
    const toks = tokenizeLine('x = "a b c"');
    expect(toks.find((t) => t.kind === "string")?.text).toBe('"a b c"');
  });

  it("marks a call identifier as a function and PascalCase as a type", () => {
    expect(
      tokenizeLine("doThing()").find((t) => t.text === "doThing")?.kind,
    ).toBe("function");
    expect(
      tokenizeLine("const x: Widget = y;").find((t) => t.text === "Widget")
        ?.kind,
    ).toBe("type");
  });

  it("does not treat a '#' inside a string as a comment", () => {
    const toks = tokenizeLine('const c = "#fff";');
    expect(toks.some((t) => t.kind === "comment")).toBe(false);
    expect(toks.find((t) => t.kind === "string")?.text).toBe('"#fff"');
  });

  it("handles an unterminated string without looping forever", () => {
    const toks = tokenizeLine("x = 'oops");
    expect(toks.map((t) => t.text).join("")).toBe("x = 'oops");
  });
});

describe("classifyDiffLine", () => {
  it("distinguishes markers, hunks, and metadata", () => {
    expect(classifyDiffLine("+++ b/file.ts")).toBe("meta");
    expect(classifyDiffLine("--- a/file.ts")).toBe("meta");
    expect(classifyDiffLine("diff --git a/f b/f")).toBe("meta");
    expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(classifyDiffLine("+added")).toBe("add");
    expect(classifyDiffLine("-removed")).toBe("del");
    expect(classifyDiffLine(" context")).toBe("context");
  });

  it("strips the marker from the body only for real content lines", () => {
    expect(diffLineBody("+hello", "add")).toBe("hello");
    expect(diffLineBody("-bye", "del")).toBe("bye");
    expect(diffLineBody(" ctx", "context")).toBe("ctx");
    expect(diffLineBody("@@ -1 +1 @@", "hunk")).toBe("@@ -1 +1 @@");
  });
});

describe("renderDiffLines", () => {
  const raw = [
    "diff --git a/f.ts b/f.ts",
    "index 000..111 100644",
    "--- a/f.ts",
    "+++ b/f.ts",
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "+const c = 4;",
    " return a;",
  ].join("\n");

  it("numbers old and new lines from the hunk header", () => {
    const lines = renderDiffLines(raw);
    const del = lines.find((l) => l.kind === "del");
    const add = lines.find((l) => l.kind === "add");
    // `-const b = 2;` was old line 2; `+const b = 3;` is new line 2.
    expect(del?.oldLine).toBe(2);
    expect(del?.newLine).toBeNull();
    expect(add?.oldLine).toBeNull();
    expect(add?.newLine).toBe(2);
  });

  it("advances the new-line counter across consecutive additions", () => {
    const lines = renderDiffLines(raw);
    const adds = lines.filter((l) => l.kind === "add");
    expect(adds.map((a) => a.newLine)).toEqual([2, 3]);
  });

  it("does not syntax-tokenize hunk or meta lines", () => {
    const lines = renderDiffLines(raw);
    for (const l of lines) {
      if (l.kind === "hunk" || l.kind === "meta") expect(l.tokens).toEqual([]);
    }
  });

  it("tokenizes content lines with the marker stripped", () => {
    const lines = renderDiffLines(raw);
    const add = lines.find((l) => l.body.startsWith("const b = 3"));
    expect(add?.tokens.some((t) => t.kind === "keyword")).toBe(true);
  });

  it("counts additions and deletions", () => {
    expect(diffStat(renderDiffLines(raw))).toEqual({ added: 2, removed: 1 });
  });

  it("tolerates an empty diff", () => {
    expect(renderDiffLines("")).toEqual([
      expect.objectContaining({ kind: "context", body: "" }),
    ]);
    expect(diffStat(renderDiffLines(""))).toEqual({ added: 0, removed: 0 });
  });
});
