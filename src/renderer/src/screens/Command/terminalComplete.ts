/**
 * `cd` path completion for the integrated terminal.
 *
 * WHY THIS IS CLIENT-SIDE: the terminal is a real pty — xterm sends each
 * keystroke straight to the shell, so there is no input widget to attach an
 * autocomplete to. To offer a dropdown we must do two things:
 *
 *   1. TRACK what the user has typed on the CURRENT line (the shell owns the
 *      buffer, so we mirror it from the keystrokes we forward), and
 *   2. detect when that line is a `cd` (or similar directory command).
 *
 * Only directory-taking commands are completed. Completing arbitrary commands
 * would mean reimplementing shell completion, which would diverge from the
 * shell's own Tab behaviour and surprise anyone used to it.
 */

/** Commands whose first argument is a directory. */
const DIR_COMMANDS = new Set([
  "cd",
  "pushd",
  "popd",
  "chdir",
  "ls",
  "dir",
  "ll",
  "la",
]);

/**
 * Commands whose arguments are directories but which are NOT path-completed
 * here, because their first token after the command may be a flag (e.g.
 * `code -n /path`). Completion only fires for the token the caret is in.
 */

export interface CompletionContext {
  /** The full command word being completed, e.g. "cd". */
  command: string;
  /** The partial argument the caret is in, e.g. "../src/comp". */
  fragment: string;
  /** Directory part of the fragment, relative to the cwd. "" for a bare name. */
  dirPart: string;
  /** The filename prefix being completed, e.g. "comp". */
  namePrefix: string;
}

/** Quote/escape a path for insertion into the shell. */
export function quotePath(path: string): string {
  // Tab-completion inserts a path the shell must re-parse. A space or shell
  // metacharacter would split the token, so anything non-trivial is quoted.
  //
  // `/` is safe as a separator. A BACKSLASH is not: on POSIX shells it is an
  // escape character, so a Windows-style path must be quoted there — which is
  // correct, because the shell in use decides how it is parsed.
  if (/^[A-Za-z0-9._@%+,:^=/-]+$/.test(path)) return path;
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Parse the line being typed and decide whether to complete.
 *
 * Returns null when the line is not a directory command, or when the caret is
 * not in an argument position (e.g. still typing the command name itself).
 */
export function parseCompletionContext(line: string): CompletionContext | null {
  // Only the text before the caret matters; the shell cares about the same.
  const trimmedStart = line.replace(/^\s+/, "");
  if (!trimmedStart) return null;

  // Tokenise naively on whitespace. This matches how a user types paths; a
  // path containing unquoted spaces is already ambiguous to the shell too.
  const tokens = trimmedStart.split(/\s+/);

  // The first token is the command. If the user is still typing it (no space
  // yet), there is nothing to complete.
  const command = tokens[0];
  if (!DIR_COMMANDS.has(command)) return null;
  if (tokens.length < 2) return null;

  // The fragment is the LAST token — that is where the caret is, because we
  // only ever look at the line as typed so far.
  const fragment = tokens[tokens.length - 1];
  if (!fragment) return null;

  // A leading `-` is a flag, not a path.
  if (fragment.startsWith("-")) return null;

  const slash = Math.max(fragment.lastIndexOf("/"), fragment.lastIndexOf("\\"));
  const dirPart = slash >= 0 ? fragment.slice(0, slash + 1) : "";
  const namePrefix = slash >= 0 ? fragment.slice(slash + 1) : fragment;

  // `cd ~` and `cd $VAR` are shell expansions we cannot resolve here. Checked
  // on the FRAGMENT, not just the name prefix: in `~/proj` the tilde is in the
  // prefix position of the whole token, before the slash is split off.
  if (fragment.startsWith("~") || fragment.startsWith("$")) return null;
  if (namePrefix.startsWith("~") || namePrefix.startsWith("$")) return null;

  return { command, fragment, dirPart, namePrefix };
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * Filter directory entries against a prefix.
 *
 * Directories only: `cd file.txt` fails, and offering files would produce
 * suggestions the shell immediately rejects. Hidden entries are included only
 * when the user has typed a leading dot, matching shell convention.
 */
export function matchDirectories(
  entries: readonly DirEntry[],
  namePrefix: string,
): DirEntry[] {
  const wantsHidden = namePrefix.startsWith(".");
  const needle = namePrefix.toLowerCase();

  return entries
    .filter((e) => e.isDirectory)
    .filter((e) => (wantsHidden ? true : !e.name.startsWith(".")))
    .filter((e) => e.name.toLowerCase().startsWith(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve the directory to list, given the terminal's cwd and the fragment.
 *
 * Absolute and relative prefixes both work; `dirPart` is joined onto the cwd.
 * Windows and POSIX separators are both accepted because the app runs on both.
 */
export function resolveListingDir(cwd: string, dirPart: string): string {
  if (!dirPart) return cwd;
  const isAbsolutePosix = dirPart.startsWith("/");
  // `C:\...` or `C:/...`
  const isAbsoluteWin = /^[A-Za-z]:[\\/]/.test(dirPart);
  if (isAbsolutePosix || isAbsoluteWin) {
    // Trim exactly one trailing separator so join semantics stay predictable.
    return dirPart.replace(/[\\/]$/, "") || "/";
  }
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const base = cwd.replace(/[\\/]$/, "");
  const rel = dirPart.replace(/[\\/]$/, "");
  return rel ? `${base}${sep}${rel}` : base;
}

/**
 * Build the replacement text for the current fragment.
 *
 * Directories get a trailing separator so the user can keep drilling without
 * typing it, exactly like shell Tab completion.
 */
export function buildInsertion(
  dirPart: string,
  name: string,
  separator = "/",
): string {
  return `${dirPart}${name}${separator}`;
}

/**
 * The keystrokes needed to replace `before` (already echoed by the shell) with
 * `after`.
 *
 * We cannot edit the shell's buffer directly, so we send the shell the erasing
 * control characters and then the new text: Ctrl-U clears to the start of the
 * line on POSIX shells, then we retype the whole line.
 *
 * NOTE: the whole line is retyped, not just the fragment, because Ctrl-U also
 * discards the command word.
 */
export function replacementKeystrokes(fullLine: string): string {
  // Ctrl-U (kill to line start), then the rebuilt line.
  return `\u0015${fullLine}`;
}

/** Rebuild the current line with the completed path. */
export function applyCompletion(
  line: string,
  insertion: string,
): string {
  const trimmed = line.replace(/^\s+/, "");
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return line;
  tokens[tokens.length - 1] = quotePath(insertion);
  return tokens.join(" ");
}
