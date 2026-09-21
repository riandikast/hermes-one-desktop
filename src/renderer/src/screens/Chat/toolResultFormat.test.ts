import { describe, expect, it } from "vitest";
import { formatToolResult } from "./toolResultFormat";

describe("formatToolResult", () => {
  it("unwraps a terminal envelope into output + exit-code metadata", () => {
    // The real shape: the payload is a single JSON-escaped string.
    const raw = JSON.stringify({
      output: "src/a.ts:12:  const x = 1;\nsrc/b.ts:4:  const y = 2;",
      exit_code: 0,
      error: null,
    });
    const result = formatToolResult(raw);

    expect(result.tone).toBe("ok");
    expect(result.title).toBe("Result");
    // The body is the unescaped output, not the envelope.
    expect(result.sections[0]!.body).toContain("src/a.ts:12");
    expect(result.sections[0]!.body.split("\n")).toHaveLength(2);
    expect(result.sections[0]!.body).not.toContain("\\n");
    expect(result.sections[0]!.label).toBe("Output");
    expect(result.meta).toContain("exit 0");
  });

  it("surfaces a non-zero exit code and the error text", () => {
    const raw = JSON.stringify({
      output: "",
      exit_code: 1,
      error: "command not found: rg",
    });
    const result = formatToolResult(raw);

    expect(result.tone).toBe("error");
    expect(result.title).toBe("Error");
    expect(result.meta).toContain("exit 1");
    // With no output, the error message is the body.
    expect(result.sections.map((s) => s.body)).toContain(
      "command not found: rg",
    );
  });

  it("unwraps a file-read envelope into content plus line-count metadata", () => {
    const raw = JSON.stringify({
      content: "1|line one\n2|line two",
      total_lines: 2,
      file_size: 1024,
      truncated: true,
      is_binary: false,
      is_image: false,
    });
    const result = formatToolResult(raw);

    expect(result.sections[0]!.label).toBe("File content");
    expect(result.sections[0]!.body).toBe("1|line one\n2|line two");
    expect(result.meta).toEqual(
      expect.arrayContaining(["2 lines", "1,024 bytes", "truncated"]),
    );
    // Redundant flags must not clutter the chip row.
    expect(result.meta.join(" ")).not.toMatch(/binary|image|success/);
  });

  it("renders a patch envelope with the diff as its own labelled section", () => {
    const raw = JSON.stringify({
      success: true,
      diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new",
      files_modified: ["x"],
      resolved_path: "C:/tmp/x",
      lint: { status: "ok" },
    });
    const result = formatToolResult(raw);

    const diff = result.sections.find((s) => s.label === "Diff");
    expect(diff).toBeDefined();
    expect(diff!.language).toBe("diff");
    expect(diff!.body).toContain("+new");
    expect(result.tone).toBe("ok");
  });

  it("marks a failed envelope as an error even when it also has output", () => {
    const raw = JSON.stringify({ success: false, error: "permission denied" });
    const result = formatToolResult(raw);
    expect(result.tone).toBe("error");
    expect(result.sections.some((s) => s.body.includes("permission denied"))).toBe(
      true,
    );
  });

  it("keeps plain terminal text as-is and titles it by content", () => {
    const clean = formatToolResult("warning: 3 files changed");
    expect(clean.tone).toBe("neutral");
    expect(clean.sections[0]!.body).toBe("warning: 3 files changed");

    const failed = formatToolResult("Traceback: TypeError at line 4");
    expect(failed.tone).toBe("error");
    expect(failed.title).toBe("Error");
  });

  it("pretty-prints unrecognised JSON instead of losing it", () => {
    const result = formatToolResult(JSON.stringify({ weird_key: [1, 2, 3] }));
    expect(result.sections[0]!.language).toBe("json");
    expect(result.sections[0]!.body).toContain("weird_key");
  });

  it("never returns an empty body", () => {
    for (const input of ["", "{}", "null", "[]", "   "]) {
      const result = formatToolResult(input);
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.sections[0]!.body.length).toBeGreaterThan(0);
    }
  });
});
