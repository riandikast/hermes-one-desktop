/**
 * @-mention file picker helpers.
 * Pure functions — no DOM, no IPC. Unit-testable in isolation.
 */

export interface MentionEntry {
  name: string;
  isDirectory: boolean;
  /** Absolute path inserted into the prompt on select. */
  path: string;
}

/**
 * Subsequence fuzzy score. Lower is better; null = no match.
 * - every query char must appear in `target`, in order
 * - contiguous runs and prefix matches score lower (better)
 * - longer targets get a small penalty
 */
export function scoreFuzzy(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti === last + 1 ? 1 : 4; // contiguous run bonus
      if (ti === 0) score -= 2; // prefix bonus
      last = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return score + t.length - q.length; // length penalty
}

/**
 * Middle-truncate a long path for compact display: keep the head and the
 * tail (the part that identifies the file), join with "...".
 * e.g. "src/renderer/src/screens/Chat/ChatInput.tsx" (over budget) →
 *      "src/renderer/src/.../screens/Chat/ChatInput.tsx"
 */
export function truncatePath(path: string, head = 24, tail = 52): string {
  if (path.length <= head + tail) return path;
  return `${path.slice(0, head)}...${path.slice(path.length - tail)}`;
}

// Invisible sentinel markers wrap mention tags inside the raw input value.
// The textarea renders only the name; the path rides along invisibly and is
// swapped back in at send time. Out-of-band chars can't collide with typing.
export const MENTION_START = "\uE000";
export const MENTION_SEP = "\uE001";
export const MENTION_END = "\uE002";
const MENTION_RE = /[\uE000][^\uE001]*[\uE001][^\uE002]*[\uE002]/g;

export interface MentionTag {
  name: string;
  path: string;
  start: number;
  end: number;
}

export function parseTags(text: string): MentionTag[] {
  const tags: MentionTag[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const inner = m[0].slice(1, -1).split(MENTION_SEP);
    if (inner.length === 2 && inner[1].length > 0) {
      tags.push({
        name: inner[0],
        path: inner[1],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return tags;
}

/** Replace mention tags with their real paths; drop any stray markers. */
export function expandTags(text: string): string {
  return text
    .replace(MENTION_RE, (raw) => {
      const inner = raw.slice(1, -1).split(MENTION_SEP);
      return inner.length === 2 ? inner[1] : "";
    })
    .replace(/[\uE000\uE001\uE002]/g, "");
}

/**
 * Display form of the raw input: each tag collapses to a single zero-width
 * space, so the textarea shows no tag text at all (badges render in a chip
 * row above). The ZWSP is invisible in every font — unlike the PUA sentinel
 * trio it replaces, which leaked as tofu boxes in some UI fonts — and it
 * still occupies one character position, so backspace/selection can delete
 * a tag directly in the textarea.
 */
export const TAG_DISPLAY_CHAR = "\u200B";

export function displayText(raw: string): string {
  return raw.replace(MENTION_RE, TAG_DISPLAY_CHAR);
}

/**
 * Map a caret/selection offset in DISPLAY space to the corresponding offset
 * in RAW space. Offsets inside a tag (its single ZWSP) map to the tag's raw
 * start; offsets at/after the tag end map to the tag's raw end.
 */
export function displayToRawPos(raw: string, displayPos: number): number {
  let d = 0;
  let r = 0;
  for (const tag of parseTags(raw)) {
    const outsideLen = tag.start - r;
    if (displayPos <= d + outsideLen) return r + (displayPos - d);
    d += outsideLen;
    if (displayPos < d + TAG_DISPLAY_CHAR.length) return tag.start;
    d += TAG_DISPLAY_CHAR.length;
    r = tag.end;
  }
  return r + (displayPos - d);
}

/**
 * Map a RAW offset to DISPLAY space (for setSelectionRange after inserts).
 */
export function rawToDisplayPos(raw: string, rawPos: number): number {
  let d = 0;
  let lastEnd = 0;
  for (const tag of parseTags(raw)) {
    if (rawPos <= tag.start) break;
    d += tag.start - lastEnd;
    if (rawPos < tag.end) return d;
    d += TAG_DISPLAY_CHAR.length;
    lastEnd = tag.end;
  }
  return d + (rawPos - lastEnd);
}

/**
 * Locate an active mention at `caret` in `text`.
 * Trigger rule: a `@` preceded by start-of-string or whitespace, followed
 * (up to the caret) by non-whitespace, non-`@` chars.
 * `@/` is a folder token: only directories match, and the query runs from
 * after the slash. Returns the offset of `@`, the query typed so far, and
 * whether the token is a folder picker, or null.
 */
export function findMention(
  text: string,
  caret: number,
): { start: number; query: string; folderOnly: boolean } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  // Query runs from after `@` to the caret, capped at the first
  // whitespace or `@` (a space/at-sign ends the current mention).
  const after = text.slice(at + 1, caret);
  if (after.startsWith("@")) return null;
  const end = after.search(/[\s@]/);
  let query = end === -1 ? after : after.slice(0, end);
  let folderOnly = false;
  if (query.startsWith("/")) {
    folderOnly = true;
    query = query.slice(1);
  }
  return { start: at, query, folderOnly };
}

/** Last path segment of a (forward-slash-separated) entry name. */
export function basename(name: string): string {
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i + 1);
}

// Rank bonuses (lower is better). Exact basename matches must always win,
// then exact full-path matches, basename prefixes, basename substrings,
// basename subsequences, then full-path matches.
const EXACT_NAME_BONUS = -1000;
const EXACT_PATH_BONUS = -950;
const BASENAME_PREFIX_BONUS = -200;
const BASENAME_SUBSTRING_BONUS = -100;
const BASENAME_FUZZY_BONUS = -50;

/** Case-fold and normalize Windows backslashes so `app\src\x.ts` finds
 * `app/src/x.ts` entries. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\\/g, "/");
}

/**
 * Filter + rank mention entries for the dropdown.
 * - `@` (folderOnly=false) lists files only; `@/` (folderOnly=true) lists
 *   directories only. Hint rows (empty `path`) always pass through.
 * - Exact basename match (case-insensitive, extension included) ranks first;
 *   exact full-path next; basename-prefix next; basename substring next;
 *   basename subsequence next; plain full-path subsequence last.
 * - Path length breaks near-ties (shorter path = closer to root wins).
 * - Empty query keeps walk order (all entries of the matching kind).
 */
export function rankMentions(
  query: string,
  entries: MentionEntry[],
  folderOnly: boolean,
): MentionEntry[] {
  const q = normalize(query);
  const scored: { en: MentionEntry; score: number }[] = [];
  for (const en of entries) {
    if (en.path === "") {
      scored.push({ en, score: 0 });
      continue;
    }
    if (en.isDirectory !== folderOnly) continue;
    let score: number | null;
    if (q.length === 0) {
      score = 0;
    } else {
      const name = normalize(en.name);
      const base = basename(name);
      const baseFuzzy = scoreFuzzy(q, base);
      if (base === q) {
        score = EXACT_NAME_BONUS;
      } else if (name === q) {
        score = EXACT_PATH_BONUS;
      } else if (base.startsWith(q)) {
        score = (baseFuzzy ?? 0) + BASENAME_PREFIX_BONUS;
      } else if (base.includes(q)) {
        score = (baseFuzzy ?? 0) + BASENAME_SUBSTRING_BONUS;
      } else if (baseFuzzy !== null) {
        score = baseFuzzy + BASENAME_FUZZY_BONUS;
      } else {
        score = scoreFuzzy(q, name);
      }
      if (score === null) continue;
      if (q.length > 0) score += en.name.length / 1000;
    }
    scored.push({ en, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.en);
}
