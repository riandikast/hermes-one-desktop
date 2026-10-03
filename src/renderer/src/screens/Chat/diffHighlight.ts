/**
 * Syntax highlighting for unified diffs in the Source Control pane.
 *
 * Why not reuse the markdown `<Prism>` path: a diff is not one language. Each
 * hunk mixes two files' worth of lines, and the diff markers themselves (`+`,
 * `-`, `@@`) are not part of any grammar. Running the whole diff through a
 * Prism grammar colours punctuation as if it were source and loses the add/del
 * distinction the user actually reads by.
 *
 * So we tokenize per line, by hand, with a small language-agnostic grammar
 * (strings, comments, numbers, keywords, types, functions). That is enough to
 * give the VS Code "coloured diff" feel without a 300 KB grammar bundle, and it
 * never misreads ordinary prose as syntax.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "property"
  | "operator"
  | "punctuation";

export interface DiffToken {
  kind: TokenKind;
  text: string;
}

/** Change kind of a diff line, independent of the syntax tokens inside it. */
export type DiffLineKind = "add" | "del" | "context" | "hunk" | "meta";

/** A language-agnostic keyword set (JS/TS/Python/C-ish/shell overlap). */
const KEYWORDS = new Set([
  // declarations / control flow
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "throw",
  "try",
  "catch",
  "finally",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "await",
  "async",
  "yield",
  "default",
  // visibility / modifiers
  "public",
  "private",
  "protected",
  "readonly",
  "static",
  "abstract",
  "export",
  "import",
  "from",
  "as",
  "extends",
  "implements",
  "declare",
  // python / shell-ish
  "def",
  "elif",
  "lambda",
  "pass",
  "raise",
  "with",
  "global",
  "nonlocal",
  "and",
  "or",
  "not",
  "is",
  "None",
  "True",
  "False",
  "self",
  "echo",
  "then",
  "esac",
  "local",
  // literals
  "null",
  "undefined",
  "true",
  "false",
  "this",
  "super",
  "void",
]);

/** Identifier colouring: names that read as types (PascalCase) vs calls. */
const LINE_PRIMITIVES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "never",
  "object",
  "symbol",
  "bigint",
  "void",
  "Promise",
  "Array",
  "Record",
  "Map",
  "Set",
]);

const isIdentStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);
const isIdent = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

/**
 * Tokenize one line of source. Never throws and always consumes input, so the
 * caller can concatenate the tokens and get the original text back.
 */
export function tokenizeLine(line: string): DiffToken[] {
  const tokens: DiffToken[] = [];
  let i = 0;
  const push = (kind: TokenKind, text: string): void => {
    if (text) tokens.push({ kind, text });
  };

  // Trailing-comment detection needs the "not inside a string" state, which the
  // loop already tracks, so comments fall out naturally.
  while (i < line.length) {
    const ch = line[i];

    // Line comments: //, #, -- (sql/lua-ish), and /* */ on one line.
    if (ch === "#") {
      push("comment", line.slice(i));
      break;
    }
    if (ch === "/" && line[i + 1] === "/") {
      push("comment", line.slice(i));
      break;
    }
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const stop = end === -1 ? line.length : end + 2;
      push("comment", line.slice(i, stop));
      i = stop;
      continue;
    }

    // Strings (single, double, backtick) and chars.
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      push("string", line.slice(i, Math.min(j, line.length)));
      i = j;
      continue;
    }

    // Numbers (int, float, hex, with separators).
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j += 1;
      push("number", line.slice(i, j));
      i = j;
      continue;
    }

    // Identifiers / keywords.
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < line.length && isIdent(line[j])) j += 1;
      const word = line.slice(i, j);
      // A call: identifier immediately followed by `(`.
      const nextNonSpace = line.slice(j).match(/^\s*\(/);
      if (KEYWORDS.has(word)) push("keyword", word);
      else if (LINE_PRIMITIVES.has(word)) push("type", word);
      else if (/^[A-Z]/.test(word)) push("type", word);
      else if (nextNonSpace) push("function", word);
      else push("plain", word);
      i = j;
      continue;
    }

    // Operators.
    if (/[+\-*/%=<>!&|^~?:]/.test(ch)) {
      let j = i + 1;
      while (j < line.length && /[+\-*/%=<>!&|^~?:]/.test(line[j])) j += 1;
      push("operator", line.slice(i, j));
      i = j;
      continue;
    }

    // Punctuation and whitespace.
    if (/[()[\]{},;.]/.test(ch)) {
      push("punctuation", ch);
      i += 1;
      continue;
    }

    // Anything else (whitespace, unicode) stays plain, coalesced.
    let j = i + 1;
    while (
      j < line.length &&
      !isIdentStart(line[j]) &&
      !isDigit(line[j]) &&
      !/[+\-*/%=<>!&|^~?:()[\]{},;."'`#]/.test(line[j])
    ) {
      j += 1;
    }
    push("plain", line.slice(i, j));
    i = j;
  }

  return tokens;
}

/** Classify a raw unified-diff line. */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename ")
  ) {
    return "meta";
  }
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** The source text of a diff line, with its +/-/space marker stripped. */
export function diffLineBody(line: string, kind: DiffLineKind): string {
  if (kind === "add" || kind === "del" || kind === "context") {
    return line.slice(1);
  }
  return line;
}

/**
 * Parse a unified diff into per-line records with syntax tokens. Also pulls the
 * old/new line numbers out of `@@ -a,b +c,d @@` headers so the gutters can show
 * real file line numbers, like VS Code.
 */
export interface DiffRenderLine {
  kind: DiffLineKind;
  /** Original raw line (with marker). */
  raw: string;
  /** Source text to tokenize (marker stripped). */
  body: string;
  tokens: DiffToken[];
  /** Old-file line number, null outside a hunk / for additions. */
  oldLine: number | null;
  /** New-file line number, null outside a hunk / for deletions. */
  newLine: number | null;
}

export function renderDiffLines(raw: string): DiffRenderLine[] {
  const out: DiffRenderLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const line of raw.replace(/\n$/, "").split("\n")) {
    const kind = classifyDiffLine(line);
    let oldLine: number | null = null;
    let newLine: number | null = null;

    if (kind === "hunk") {
      // `@@ -12,7 +14,9 @@ optional heading`
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      inHunk = true;
    } else if (kind === "add") {
      if (inHunk) {
        newLine = newNo;
        newNo += 1;
      }
    } else if (kind === "del") {
      if (inHunk) {
        oldLine = oldNo;
        oldNo += 1;
      }
    } else if (kind === "context") {
      if (inHunk) {
        oldLine = oldNo;
        newLine = newNo;
        oldNo += 1;
        newNo += 1;
      }
    }

    const body = diffLineBody(line, kind);
    out.push({
      kind,
      raw: line,
      body,
      // Headers/hunks are diff metadata, not source — don't syntax-colour them.
      tokens: kind === "hunk" || kind === "meta" ? [] : tokenizeLine(body),
      oldLine,
      newLine,
    });
  }

  return out;
}

/** Count +/- lines for a compact stat chip. */
export function diffStat(lines: DiffRenderLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added += 1;
    else if (l.kind === "del") removed += 1;
  }
  return { added, removed };
}
