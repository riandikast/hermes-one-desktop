import { useMemo } from "react";
import { Prism } from "react-syntax-highlighter";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";

/**
 * Terminal-style rendering for tool commands and their output.
 *
 * Plain `CodeBlock` is the wrong shape here: it wraps content in a bordered
 * code container with a language header, which reads as "a snippet pasted into
 * markdown" rather than "what ran in the shell". Two problems the user hit:
 *
 *  - the Command block had its own bordered/backed container stacked inside the
 *    tool row's container (a box in a box);
 *  - the Result body used the code-block background, which in a light-ish theme
 *    looks like text selected with a highlight.
 *
 * So: no wrapper chrome, no background fill, and terminal-flavoured colour —
 * shell syntax for the command line, and output coloured by LINE
 * (errors/warnings/diff/success) for the result, which is how a terminal
 * actually reads.
 *
 * Colour choices are per-theme via `toneFor`, and Prism is given a transparent
 * background so only the glyphs are coloured.
 */

export type TerminalTone = "command" | "output" | "error";

/** OneDark, with the container backgrounds stripped so nothing is filled. */
function transparentTheme(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    'pre[class*="language-"]': {
      ...(base['pre[class*="language-"]'] as Record<string, unknown>),
      background: "transparent",
      margin: 0,
      padding: 0,
      overflow: "visible",
    },
    'code[class*="language-"]': {
      ...(base['code[class*="language-"]'] as Record<string, unknown>),
      background: "transparent",
      textShadow: "none",
    },
  };
}

/** Highlight a shell command line. Falls back to plain text if Prism fails. */
export function TerminalCommand({ command }: { command: string }): React.JSX.Element {
  const theme = useMemo(() => transparentTheme(oneDark as never), []);
  return (
    <div className="chat-terminal-command">
      <span className="chat-terminal-prompt" aria-hidden>
        $
      </span>
      <Prism
        language="bash"
        style={theme as never}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: 0,
          background: "transparent",
          fontSize: "12px",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {command}
      </Prism>
    </div>
  );
}

/** Classify one output line so ANSI-ish semantics can be coloured. */
function lineTone(line: string): string | null {
  if (/^\s*(error|fatal|panic|exception|traceback)\b/i.test(line)) return "error";
  if (/^\s*(warning|warn|deprecated)\b/i.test(line)) return "warn";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  if (/^\s*(✓|√|PASS(ED)?|ok\b|done\b|success)/.test(line)) return "ok";
  if (/^\s*(✗|×|FAIL(ED)?|error:)/i.test(line)) return "fail";
  if (/^\s*\$ /.test(line)) return "prompt";
  if (/^\s*\d+ (passed|failed)/.test(line)) return "summary";
  return null;
}

/**
 * Terminal-style output body: no fill, monospace, and per-line emphasis so
 * errors, warnings, diffs and success lines read like a real terminal.
 *
 * Deliberately NOT Prism: shell OUTPUT is not bash source, and running it
 * through a language grammar produces arbitrary colouring that misreads
 * ordinary text as syntax.
 */
export function TerminalOutput({ body }: { body: string }): React.JSX.Element {
  const lines = useMemo(() => body.replace(/\n$/, "").split("\n"), [body]);

  // Very large outputs stay plain: thousands of spans for a build log is a
  // measurable cost, and the scrolling wall of text is the same either way.
  if (lines.length > 4000) {
    return <pre className="chat-terminal-output">{body}</pre>;
  }

  return (
    <pre className="chat-terminal-output">
      {lines.map((line, index) => {
        const tone = lineTone(line);
        return (
          <span key={index} className={tone ? `chat-terminal-line--${tone}` : undefined}>
            {line}
            {index < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </pre>
  );
}
