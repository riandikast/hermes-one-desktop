import { describe, expect, it } from "vitest";
import { extractToolPath } from "./fileChanges";

describe("extractToolPath", () => {
  it("reads a plain path key from args", () => {
    expect(extractToolPath({ path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(extractToolPath({ file_path: "/a/c.ts" })).toBe("/a/c.ts");
    expect(extractToolPath({ file: "/a/d.ts" })).toBe("/a/d.ts");
    expect(extractToolPath({ target: "/a/e.ts" })).toBe("/a/e.ts");
  });

  it("reads a nested path inside a stringified arg", () => {
    expect(extractToolPath({ path: "/a/x.ts", content: "hi" })).toBe("/a/x.ts");
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
      extractToolPath({ file_path: "relative.ts", absolute_path: "/abs/rel.ts" }),
    ).toBe("/abs/rel.ts");
  });
});
