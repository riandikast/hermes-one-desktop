/**
 * Language inference for tool-result highlighting.
 *
 * Two independent problems, deliberately solved separately:
 *
 *  1. TERMINAL output. Shell output has no declared language. The pragmatic
 *     win is not "highlight it as bash" — shell OUTPUT is data, and running a
 *     bash grammar over it misreads ordinary log lines as keywords. Instead
 *     `TerminalOutput` already colours by terminal SEMANTICS (errors, diffs,
 *     pass/fail). What it lacks is a language for embedded payloads: a command
 *     that prints JSON, or `cat`s a source file, currently renders flat.
 *     `detectOutputLanguage` sniffs those.
 *
 *  2. READ-FILE content. This is real source code, so the language comes from
 *     the FILE EXTENSION — a far stronger signal than content sniffing. The
 *     catch: the extension lives on the originating CALL's args, not on the
 *     result, so the caller must pair them by callId (see HistoryRow).
 *
 * Pure and dependency-free so it can be unit-tested directly.
 */

/** Extension → Prism grammar. Only grammars verified present in the bundled
 *  react-syntax-highlighter set are listed; an unknown name would render
 *  unhighlighted with no error, which is silent degradation. */
const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  // Web
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  html: "markup",
  htm: "markup",
  vue: "markup",
  svelte: "markup",
  css: "css",
  scss: "scss",
  less: "less",
  // Data / config
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  env: "properties",
  properties: "properties",
  csv: "csv",
  // Docs
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  rst: "markdown",
  // Shell
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  psm1: "powershell",
  bat: "batch",
  cmd: "batch",
  // Systems / compiled
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  go: "go",
  rs: "rust",
  swift: "swift",
  m: "objectivec",
  mm: "objectivec",
  dart: "dart",
  php: "php",
  rb: "ruby",
  py: "python",
  pyi: "python",
  // Query / schema
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  // Build / infra
  dockerfile: "docker",
  tf: "hcl",
  hcl: "hcl",
  mk: "makefile",
  gradle: "groovy",
  // Misc
  diff: "diff",
  patch: "diff",
  log: "text",
  txt: "text",
};

/** Basenames with no usable extension (or a misleading one). */
const BASENAME_LANGUAGES: Readonly<Record<string, string>> = {
  dockerfile: "docker",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  "package.json": "json",
  ".gitignore": "git",
  ".dockerignore": "git",
  ".npmrc": "ini",
  ".env": "properties",
  "go.mod": "go",
  "cargo.toml": "toml",
};

/**
 * Prism grammar names that react-syntax-highlighter ships under a DIFFERENT
 * key than the conventional name. Map the conventional name we inferred to
 * the key that actually exists, so the grammar is found.
 */
const GRAMMAR_ALIASES: Readonly<Record<string, string>> = {
  // `bash` is the bundled shell grammar; `shell`/`sh` do not exist as keys.
  shell: "bash",
  sh: "bash",
  // `markup` is the bundled HTML/XML grammar (`xml`/`html` are absent).
  xml: "markup",
  html: "markup",
};

/** Does the bundled highlighter actually have this grammar? */
export function normaliseGrammar(language: string): string {
  const lower = language.toLowerCase();
  return GRAMMAR_ALIASES[lower] ?? lower;
}

/** The file's basename, handling both separators. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Language for a file, from its extension (falling back to a known basename).
 * Returns "text" when nothing is recognised — callers render plain text then.
 */
export function languageFromPath(path: string | null | undefined): string {
  if (!path) return "text";
  const name = basename(path).toLowerCase();
  if (!name) return "text";

  const byBasename = BASENAME_LANGUAGES[name];
  if (byBasename) return byBasename;

  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "text";
  const ext = name.slice(dot + 1);
  return EXTENSION_LANGUAGES[ext] ?? "text";
}

/**
 * Sniff a language for TERMINAL OUTPUT.
 *
 * Deliberately conservative and cheap: only the case where the output is
 * unambiguously a single structured payload. A shell command that prints JSON
 * is extremely common (`curl`, `jq`, `--json`), so that is worth highlighting.
 *
 * Everything else returns "text" — NOT a shell grammar. That distinction
 * matters: shell OUTPUT is data, and running a bash grammar over it highlights
 * ordinary log lines as keywords/paths, which is actively misleading. Plain
 * "text" keeps `TerminalOutput`'s terminal-semantic colouring (errors, diff
 * lines, pass/fail) in charge, which is the more useful signal for output.
 */
export function detectOutputLanguage(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "text";

  // A single JSON value, accounting for the newline-wrapped arrays/objects that
  // pretty-printers emit.
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON (e.g. log lines that merely start with a brace).
    }
  }

  return "text";
}

/**
 * The language for a read_file-style result.
 *
 * Prefers the originating call's path; falls back to nothing (plain text)
 * rather than content-sniffing source code, which gets it wrong often enough
 * to be worse than no highlighting.
 */
export function languageForReadResult(
  path: string | null | undefined,
): string {
  return languageFromPath(path);
}
