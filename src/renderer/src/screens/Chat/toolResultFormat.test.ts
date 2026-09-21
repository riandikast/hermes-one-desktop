import { describe, expect, it } from "vitest";
import { formatToolResult } from "./toolResultFormat";

/** Render a formatted result the way the block does, for compact assertions. */
function rendered(content: string): string {
  const r = formatToolResult(content);
  return [
    `${r.title}${r.meta.length ? ` [${r.meta.join(" | ")}]` : ""}`,
    ...r.sections.map((s) => `${s.label}:\n${s.body}`),
  ].join("\n");
}

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
    // Changed files get their own line-per-path listing.
    expect(result.sections.find((s) => s.label === "Files (1)")!.body).toBe("x");
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

describe("terminal command envelopes (background / wait)", () => {
  it("shows the echoed command as its own section and drops status noise", () => {
    // Real background/wait shape from state.db.
    const out = rendered(
      JSON.stringify({
        status: "exited",
        command:
          "cd /c/Users/riand/AndroidStudioProjects/GeloraAppFlutter && flutter build apk --debug 2>&1 | tail -5",
        exit_code: 0,
        completion_reason: "exited",
        termination_source: "",
        output:
          "Running Gradle task 'assembleDebug'... 139.0s\n✓ Built build\\app\\outputs\\flutter-apk\\app-debug.apk",
      }),
    );

    expect(out).toContain("Command:");
    expect(out).toContain("flutter build apk --debug");
    expect(out).toContain("Output:");
    expect(out).toContain("✓ Built build");
    // Real newlines, not escapes.
    expect(out).not.toContain("\\n");
    // "exited" is noise beside the exit code.
    expect(out).not.toContain("exited");
    expect(out).toContain("exit 0");
  });
});

describe("skill_manage results", () => {
  it("renders operations as a list, not raw JSON", () => {
    const out = rendered(
      JSON.stringify({
        success: true,
        operations_applied: 1,
        results: [
          {
            name: "hermes-one-desktop-dev",
            action: "patch",
            file_path: "references/chat-streaming-bugs.md",
            success: true,
          },
        ],
      }),
    );

    expect(out).toContain("Skills (1 operation)");
    expect(out).toContain("✓ patch hermes-one-desktop-dev");
    expect(out).toContain("references/chat-streaming-bugs.md");
    // The raw envelope must be gone.
    expect(out).not.toContain("operations_applied");
    expect(out).not.toContain("{");
  });

  it("marks failed operations", () => {
    const out = rendered(
      JSON.stringify({
        success: false,
        operations_applied: 1,
        results: [{ name: "s", action: "delete", success: false }],
      }),
    );
    expect(out).toContain("✗ delete s");
  });
});

describe("todo results", () => {
  it("renders a checked list with status", () => {
    const out = rendered(
      JSON.stringify({
        todos: [
          { id: "a", content: "Inspect the button", status: "completed" },
          { id: "b", content: "Fix the icon", status: "in_progress" },
          { id: "c", content: "Run checks", status: "pending" },
        ],
        revision: 4,
        summary: { total: 3, pending: 1, in_progress: 1, completed: 1 },
      }),
    );

    expect(out).toContain("[x] Inspect the button");
    expect(out).toContain("[~] Fix the icon");
    expect(out).toContain("[ ] Run checks");
    expect(out).not.toContain('"content"');
  });
});

describe("file listing results", () => {
  it("puts each path on its own line", () => {
    const out = rendered(
      JSON.stringify({ total_count: 2, files: ["C:/a/One.tsx", "C:/b/Two.tsx"] }),
    );

    expect(out).toContain("Files (2)");
    expect(out).toContain("C:/a/One.tsx\nC:/b/Two.tsx");
    expect(out).not.toContain("[");
  });
});
