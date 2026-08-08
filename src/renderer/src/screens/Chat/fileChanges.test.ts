import { describe, expect, it } from "vitest";
import {
  extractToolPath,
  diffLines,
  gitChangedDuringTurn,
  gitSnapshotKey,
  changedFilesFromToolRows,
  normalizePathKey,
  type DiffLine,
} from "./fileChanges";

function text(lines: DiffLine[]): string {
  return lines
    .map(
      (l) =>
        `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${l.text}`,
    )
    .join("\n");
}

describe("extractToolPath", () => {
  it("reads a plain path key from args", () => {
    expect(extractToolPath({ path: "/repo/b.ts" })).toBe("/repo/b.ts");
    expect(extractToolPath({ file_path: "/repo/c.ts" })).toBe("/repo/c.ts");
    expect(extractToolPath({ file: "/repo/d.ts" })).toBe("/repo/d.ts");
    expect(extractToolPath({ target: "/repo/e.ts" })).toBe("/repo/e.ts");
  });

  it("reads a nested path inside a stringified arg", () => {
    expect(extractToolPath({ path: "/repo/x.ts", content: "hi" })).toBe(
      "/repo/x.ts",
    );
  });

  it("falls back to scanning the JSON text for an absolute path", () => {
    expect(
      extractToolPath({ file_path: "/repo/src/main.ts", patch: "@@" }),
    ).toBe("/repo/src/main.ts");
    expect(extractToolPath({ filename: "C:\\repo\\a\\b.ts" })).toBe(
      "C:\\repo\\a\\b.ts",
    );
  });

  it("returns null for unresolvable args", () => {
    expect(extractToolPath({ content: "just text" })).toBeNull();
    expect(extractToolPath({})).toBeNull();
    expect(extractToolPath("not an object")).toBeNull();
  });

  it("prefers absolute-looking paths over relative", () => {
    expect(
      extractToolPath({
        file_path: "relative.ts",
        absolute_path: "/abs/rel.ts",
      }),
    ).toBe("/abs/rel.ts");
  });

  it("extracts a path token embedded in a plain string", () => {
    expect(extractToolPath("Write file: C:\\tmp\\a.txt")).toBe(
      "C:\\tmp\\a.txt",
    );
    expect(extractToolPath("echo hi > C:/tmp/b.txt now")).toBe("C:/tmp/b.txt");
    expect(extractToolPath("Read C:\\repo\\src\\main.ts")).toBe(
      "C:\\repo\\src\\main.ts",
    );
  });

  it("extracts a path token embedded in a shell command arg", () => {
    expect(extractToolPath({ command: "echo hi > C:\\tmp\\a.txt" })).toBe(
      "C:\\tmp\\a.txt",
    );
    expect(
      extractToolPath({
        command: "cd C:\\proj && node build.mjs && dir /x",
      }),
    ).toBe("C:\\proj");
  });

  it("extracts a path from a JSON-encoded string arg", () => {
    expect(extractToolPath('{"command": "echo hi > C:\\\\tmp\\\\a.txt"}')).toBe(
      "C:\\tmp\\a.txt",
    );
  });

  it("does not treat URLs as paths", () => {
    expect(extractToolPath("See https://example.com/x for details")).toBeNull();
    expect(extractToolPath({ url: "https://example.com/x" })).toBeNull();
  });

  it("does not treat relative paths as absolute", () => {
    expect(extractToolPath({ command: "node src/a.js" })).toBeNull();
    expect(extractToolPath("node src/a.js")).toBeNull();
  });

  it("resolves relative path keys against the session cwd", () => {
    expect(extractToolPath({ path: "config.yaml" }, "C:\\repo")).toBe(
      "C:\\repo\\config.yaml",
    );
    expect(extractToolPath({ file: "./src/main.ts" }, "C:\\repo")).toBe(
      "C:\\repo\\src\\main.ts",
    );
    expect(
      extractToolPath({ file_path: "..\\docs\\x.md" }, "C:\\repo\\src"),
    ).toBe("C:\\repo\\docs\\x.md");
    expect(extractToolPath({ path: "config.yaml" }, "/repo")).toBe(
      "/repo/config.yaml",
    );
  });

  it("still returns null for relative paths without a baseDir", () => {
    expect(extractToolPath({ path: "config.yaml" })).toBeNull();
    expect(extractToolPath({ path: "src/a.js" })).toBeNull();
  });

  it("normalizes git-bash paths to Windows form", () => {
    expect(extractToolPath("echo hi > /c/Users/x/test.txt")).toBe(
      "C:\\Users\\x\\test.txt",
    );
    expect(extractToolPath({ cwd: "/c/Users/riand/proj" })).toBe(
      "C:\\Users\\riand\\proj",
    );
  });

  it("prefers file-like paths over a leading directory (cwd)", () => {
    expect(
      extractToolPath({
        command: "cd /c/proj && echo hi > /c/proj/test.txt",
      }),
    ).toBe("C:\\proj\\test.txt");
  });

  it("uppercases a lowercase drive letter", () => {
    expect(extractToolPath({ path: "c:\\Users\\x\\a.ts" })).toBe(
      "C:\\Users\\x\\a.ts",
    );
  });
});

describe("diffLines", () => {
  it("returns all-same for identical content", () => {
    expect(text(diffLines("a\nb\nc", "a\nb\nc")!)).toBe(" a\n b\n c");
  });

  it("marks an insertion in the middle as add", () => {
    expect(text(diffLines("a\nc", "a\nb\nc")!)).toBe(" a\n+b\n c");
  });

  it("marks a deletion in the middle as del", () => {
    expect(text(diffLines("a\nb\nc", "a\nc")!)).toBe(" a\n-b\n c");
  });

  it("marks a replacement as del + add", () => {
    expect(text(diffLines("a\nold\nc", "a\nnew\nc")!)).toBe(
      " a\n-old\n+new\n c",
    );
  });

  it("handles empty before (created file)", () => {
    expect(text(diffLines("", "x\ny")!)).toBe("+x\n+y");
  });

  it("handles empty after (deleted file)", () => {
    expect(text(diffLines("x\ny", "")!)).toBe("-x\n-y");
  });

  it("trims common prefix and suffix", () => {
    expect(text(diffLines("x\nold\nz", "x\nnew\nz")!)).toBe(
      " x\n-old\n+new\n z",
    );
  });

  it("returns null when the diff is too large to compute", () => {
    const bigA = Array.from({ length: 1200 }, (_, i) => `a${i}`).join("\n");
    const bigB = Array.from({ length: 1200 }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(bigA, bigB)).toBeNull();
  });
});

describe("gitChangedDuringTurn — read/dirty files are not attributed", () => {
  const entry = (
    path: string,
    status: string,
    after: string | null,
  ): { path: string; status: string; after: string | null } => ({
    path,
    status,
    after,
  });

  it("excludes files already dirty at turn start with unchanged content", () => {
    const snapshot = new Map<string, string>([
      ["/repo/AGENTS.md", "M|line1\nline2"], // dirty BEFORE the turn
    ]);
    const current = [
      entry("/repo/AGENTS.md", "M", "line1\nline2"), // only READ, unchanged
    ];
    expect(gitChangedDuringTurn(snapshot, current)).toEqual([]);
  });

  it("reports a file whose content changed during the turn", () => {
    const snapshot = new Map<string, string>([
      ["/repo/a.kt", "M|old"], // dirty before, but ...
    ]);
    const current = [
      entry("/repo/a.kt", "M", "old\n+new line"), // ... changed this turn
    ];
    expect(gitChangedDuringTurn(snapshot, current)).toEqual(["/repo/a.kt"]);
  });

  it("reports files that appeared during the turn (untracked created)", () => {
    const snapshot = new Map<string, string>([]);
    const current = [entry("/repo/plan.md", "??", "new content")];
    expect(gitChangedDuringTurn(snapshot, current)).toEqual(["/repo/plan.md"]);
  });

  it("reports a status change even if content is identical (deleted/added)", () => {
    const snapshot = new Map<string, string>([
      ["/repo/x.py", "M|body"],
    ]);
    const current = [entry("/repo/x.py", "D", null)]; // deleted this turn
    expect(gitChangedDuringTurn(snapshot, current)).toEqual(["/repo/x.py"]);
  });

  it("returns nothing without a snapshot (race: baseline never loaded)", () => {
    const current = [entry("/repo/a.kt", "M", "x")];
    expect(gitChangedDuringTurn(null, current)).toEqual([]);
    expect(gitChangedDuringTurn(undefined, current)).toEqual([]);
  });

  it("gitSnapshotKey encodes status + content", () => {
    expect(gitSnapshotKey("M", "abc")).toBe("M|abc");
    expect(gitSnapshotKey("??", null)).toBe("??|");
  });
});

describe("changedFilesFromToolRows", () => {
  const toolCall = (name: string, callId: string, args: string, status?: string) => ({
    kind: "tool_call",
    role: "agent",
    name,
    callId,
    args,
    status,
  });
  const toolResult = (callId: string, content: string) => ({
    kind: "tool_result",
    role: "agent",
    name: "patch",
    callId,
    content,
  });

  it("derives file-edit tools from the transcript, deduped", () => {
    const messages = [
      { kind: "user", role: "user", content: "fix it" },
      toolCall("patch", "c1", JSON.stringify({ mode: "replace", new_string: "a", old_string: "b" })),
      toolResult("c1", JSON.stringify({ success: true, resolved_path: "D:/Repo/A.cs" })),
      toolCall("write_file", "c2", JSON.stringify({ path: "/repo/B.cs" })),
      toolResult("c2", JSON.stringify({ success: true })),
    ];
    expect(changedFilesFromToolRows(messages, 1)).toEqual([
      "D:/Repo/A.cs",
      "/repo/B.cs",
    ]);
  });

  it("ignores failed edits and non-file-edit tools", () => {
    const messages = [
      { kind: "user", role: "user", content: "go" },
      toolCall("patch", "c1", JSON.stringify({ path: "/repo/A.cs" }), "failed"),
      toolCall("terminal", "c2", JSON.stringify({ command: "echo hi" })),
      toolResult("c2", JSON.stringify({ success: true, files_modified: ["C:/x/godot.log"] })),
      toolCall("patch", "c3", JSON.stringify({ path: "/repo/C.cs" })),
      toolResult("c3", JSON.stringify({ success: false, error: "no match" })),
    ];
    expect(changedFilesFromToolRows(messages, 1)).toEqual([]);
  });

  it("dedupes case-insensitively across path forms", () => {
    const messages = [
      toolCall("patch", "c1", ""),
      toolResult("c1", JSON.stringify({ success: true, resolved_path: "D:/REPO/a.cs" })),
      toolCall("patch", "c2", ""),
      toolResult("c2", JSON.stringify({ success: true, resolved_path: "d:/repo/A.cs" })),
    ];
    expect(changedFilesFromToolRows(messages, 0)).toEqual(["D:/REPO/a.cs"]);
  });
});

describe("normalizePathKey", () => {
  const BS = String.fromCharCode(92);

  it("is case-insensitive and separator-normalized", () => {
    expect(normalizePathKey(`D:${BS}Game${BS}a.cs`)).toBe(
      normalizePathKey("d:/game/a.cs"),
    );
  });
});
