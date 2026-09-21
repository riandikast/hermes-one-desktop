// @vitest-environment jsdom
//
// Syntax highlighting for tool results, wired END TO END.
//
// Two distinct asks are covered here:
//  1. terminal output that prints JSON should be syntax-highlighted;
//  2. read_file content should be highlighted BY FILE TYPE, on top of the
//     existing surface (not instead of it).
//
// The fixtures are REAL payloads pulled from state.db, including the fully
// backslashed Windows path that a real read_file call carried — the exact shape
// that has to resolve to `dart`.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ToolActivityGroup } from "./HistoryRow";
import type { ToolCallMessage, ToolResultMessage } from "./types";

/** A group of [call, result] pairs, as the transcript supplies them. */
function group(
  pairs: {
    name: string;
    args: Record<string, unknown>;
    content: string;
  }[],
): React.JSX.Element {
  const items: (ToolCallMessage | ToolResultMessage)[] = [];
  pairs.forEach((pair, i) => {
    const callId = `c${i}`;
    items.push({
      id: `tc-${i}`,
      kind: "tool_call",
      role: "agent",
      callId,
      name: pair.name,
      args: JSON.stringify(pair.args),
      status: "completed",
    });
    items.push({
      id: `tr-${i}`,
      kind: "tool_result",
      role: "agent",
      callId,
      name: pair.name,
      content: pair.content,
    });
  });
  return <ToolActivityGroup items={items} />;
}

/** The language CodeBlock reports in its header (lowercased). */
function renderedLanguages(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".chat-code-lang")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("read_file results are highlighted by file type", () => {
  // Real read_file envelope: line-numbered Dart source, no path inside it.
  const DART_CONTENT = JSON.stringify({
    content:
      '618|      ),\n619|    );\n620|  }\n621|\n622|  Widget _buildAttachmentField(_TaskDraft task) {\n623|    final canAdd = task.files.length < 3;',
    total_lines: 428,
    truncated: false,
  });

  // Verbatim from the real call's args — fully backslashed Windows path.
  const REAL_WINDOWS_PATH =
    "C:\\\\Users\\\\riand\\\\AndroidStudioProjects\\\\GeloraAppFlutter\\\\lib\\\\screens\\\\lhm\\\\form\\\\form_lhm.dart";

  it("detects Dart from the CALL's path and highlights the result", async () => {
    const { container } = render(
      group([
        {
          name: "read_file",
          args: { path: "lib/screens/lhm/form/form_lhm.dart" },
          content: DART_CONTENT,
        },
      ]),
    );

    expect(renderedLanguages(container)).toContain("dart");
  });

  it("works with the real backslashed Windows path", () => {
    const { container } = render(
      group([
        {
          name: "read_file",
          args: { path: REAL_WINDOWS_PATH },
          content: DART_CONTENT,
        },
      ]),
    );

    expect(renderedLanguages(container)).toContain("dart");
  });

  it("highlights a TypeScript file as typescript", () => {
    const { container } = render(
      group([
        {
          name: "read_file",
          args: { path: "/repo/src/main.tsx" },
          content: JSON.stringify({ content: "1|const a = 1;", total_lines: 1 }),
        },
      ]),
    );

    expect(renderedLanguages(container)).toContain("tsx");
  });

  it("falls back to plain text when the extension is unknown", () => {
    const { container } = render(
      group([
        {
          name: "read_file",
          args: { path: "/repo/notes.unknownext" },
          content: JSON.stringify({ content: "1|hello", total_lines: 1 }),
        },
      ]),
    );

    // "text" is the plain-render sentinel; only one code block should exist.
    expect(renderedLanguages(container)).toEqual(["text"]);
  });

  it("still renders the content itself, not just a language header", () => {
    const { container } = render(
      group([
        {
          name: "read_file",
          args: { path: "/repo/a.dart" },
          content: DART_CONTENT,
        },
      ]),
    );

    // The payload must survive highlighting — line-number gutters included.
    const text = container.textContent ?? "";
    expect(text).toContain("_buildAttachmentField");
    expect(text).toContain("618|");
    // And must not be shown as the raw envelope.
    expect(text).not.toContain("total_lines");
  });
});

describe("terminal output highlighting", () => {
  it("highlights output that is a single JSON document", () => {
    const { container } = render(
      group([
        {
          name: "terminal",
          args: { command: "curl -s localhost/api" },
          content: JSON.stringify({
            output: '{\n  "status": "ok",\n  "count": 3\n}',
            exit_code: 0,
          }),
        },
      ]),
    );

    expect(renderedLanguages(container)).toContain("json");
  });

  it("keeps ordinary log output in the TERMINAL renderer, not a grammar", () => {
    // The load-bearing negative case: build logs must stay semantic-coloured
    // (the .chat-terminal-output element), because running a grammar over log
    // text highlights ordinary words as keywords and misleads.
    const { container } = render(
      group([
        {
          name: "terminal",
          args: { command: "npm run build" },
          content: JSON.stringify({
            output: "> build\n✓ built in 20.45s\nsrc/a.ts 2.45 kB",
            exit_code: 0,
          }),
        },
      ]),
    );

    expect(container.querySelector(".chat-terminal-output")).not.toBeNull();
    expect(renderedLanguages(container)).not.toContain("json");
  });

  it("still shows the exit code beside the output", () => {
    const { container } = render(
      group([
        {
          name: "terminal",
          args: { command: "false" },
          content: JSON.stringify({ output: "boom", exit_code: 1, error: "fail" }),
        },
      ]),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("exit 1");
    expect(text).toContain("boom");
  });
});
