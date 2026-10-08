import { useEffect, useRef, useState } from "react";

/**
 * Monospace body with light, editor-style token colouring for the two
 * "read a prompt/message" dialogs (last-prompt, pinned-message).
 *
 * WHY a separate component instead of reusing CodeBlock: CodeBlock is a MARKDOWN
 * code block — it carries a language header, a collapse toggle and a copy
 * button, and it guesses a language from the fence. These dialogs show a PROSE
 * prompt, which has no language. Reusing CodeBlock would add a misleading
 * "code" header and a collapse control on top of a text the user is trying to
 * read.
 *
 * WHY highlight prose at all: the user asked for "text editor text highlighting
 * style" for readability. The useful part of that for prose is not language
 * tokenizing but STRUCTURE: URLs, inline code spans, quoted strings, list
 * bullets, headings and `- ` / `+ ` markers stand out, which is what makes a
 * long prompt scannable. So this highlights a small set of prose-relevant
 * tokens rather than pretending the text is a programming language.
 *
 * COST: pure regex over the string, split into spans. No highlighter import, no
 * tokenizer, so opening either dialog stays cheap even for a wall of text.
 */

type Segment = { text: string; cls: string };

/**
 * Order matters: the FIRST matching alternative wins at each position, so more
 * specific/openers must be tried before generic runs of text.
 *
 * Deliberately conservative — every pattern is anchored to something visible in
 * the text (a scheme, brackets, a quote, a line start). A greedy or fuzzy rule
 * would recolour ordinary prose and make it HARDER to read, which is the
 * opposite of the request.
 */
const TOKEN_RE = new RegExp(
  [
    // fenced code opening line, e.g. ```ts
    "(^`{3,}.*$)",
    // headings, e.g. "### Plan" (line start only)
    "(^#{1,6}[ \\t][^\\n]*$)",
    // URLs — the most useful thing to spot in a prompt full of links
    "(https?://[^\\s<>\"'`)\\]]+)",
    // inline code spans
    "(`[^`\\n]+`)",
    // quoted strings (straight and curly)
    "(\"[^\"\\n]{0,400}\"|'[^'\\n]{0,400}'|\\u201c[^\\u201d\\n]{0,400}\\u201d)",
    // bullet / numbered list openers at line start
    "(^[ \\t]*(?:[-*+]|\\d{1,3}[.)])[ \\t])",
    // file paths and flags, e.g. src/main/foo.ts, ./x, C:\y, or --verbose
    "((?:\\.{0,2}\\/|\\b[A-Za-z]:\\\\|\\b[\\w.-]+\\/)[^\\s\"'`]*\\.[A-Za-z0-9]{1,6}\\b|(?<=\\s)--?[A-Za-z][\\w-]{1,})",
    // KEY=value env style
    "(\\b[A-Z][A-Z0-9_]{2,}=[^\\s\"'`]+)",
  ].join("|"),
  "gm",
);

/** Map each capture group to its class, in the same order as TOKEN_RE. */
const GROUP_CLASSES = [
  "hl-fence",
  "hl-heading",
  "hl-url",
  "hl-code",
  "hl-quote",
  "hl-bullet",
  "hl-path",
  "hl-env",
] as const;

/**
 * Split text into highlighted segments. Exported for tests: the visual result is
 * hard to assert in jsdom, but the token boundaries are not.
 */
export function highlightSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  // exec with /g advances lastIndex; a fresh regex per call avoids shared state.
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // Zero-length matches would spin forever; skip defensively.
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    // Which alternative matched -> which class.
    let cls = "";
    for (let g = 1; g <= GROUP_CLASSES.length; g += 1) {
      if (match[g] !== undefined) {
        cls = GROUP_CLASSES[g - 1];
        break;
      }
    }
    if (last < match.index) {
      out.push({ text: text.slice(last, match.index), cls: "" });
    }
    out.push({ text: match[0], cls });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: "" });
  return out;
}

/**
 * A read-only, highlighted text body for the prompt/message dialogs.
 *
 * `tone` only changes the SURFACE (the dialogs have different chrome); the token
 * colours come from CSS so a theme switch repaints both without a re-render.
 */
export function HighlightedText({
  text,
  className = "",
  tone = "prompt",
}: {
  text: string;
  className?: string;
  tone?: "prompt" | "message";
}): React.JSX.Element {
  // Highlight only once the body has painted. A wall of text is the case this
  // is FOR, so the regex must not delay first paint of the dialog.
  const [ready, setReady] = useState(false);
  const hostRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      if (!cancelled) setReady(true);
    };
    // rAF so the plain text is on screen for the first frame; without
    // IntersectionObserver (jsdom) fall back to ready-on-mount.
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(run);
      return () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!ready) {
    // Plain text, identical layout — the swap adds colour without shifting a
    // single line (spans never change wrapping; same font/line-height).
    return (
      <pre
        ref={hostRef}
        className={`chat-hl-text chat-hl-text--${tone} ${className}`.trim()}
      >
        {text}
      </pre>
    );
  }

  return (
    <pre
      ref={hostRef}
      className={`chat-hl-text chat-hl-text--${tone} ${className}`.trim()}
    >
      {highlightSegments(text).map((seg, i) =>
        seg.cls ? (
          <span key={i} className={seg.cls}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </pre>
  );
}
