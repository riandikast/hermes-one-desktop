import { parseTags } from "../Chat/mention";

interface Reference { start: number; end: number; text: string; path: string }

/** Only explicit mention tags are portable references; prose paths stay literal. */
export function registerKnowledgeTags(content: string, references: Reference[]): { content: string; references: Reference[] } {
  const tags = parseTags(content);
  if (!tags.length) return { content, references };
  const next: Reference[] = [];
  let result = "", cursor = 0;
  for (const tag of tags) {
    result += content.slice(cursor, tag.start);
    const start = result.length;
    result += tag.path;
    next.push({ start, end: result.length, text: tag.path, path: tag.path });
    cursor = tag.end;
  }
  result += content.slice(cursor);
  for (const ref of references) {
    if (tags.some((tag) => ref.start < tag.end && ref.end > tag.start)) continue;
    const shift = tags.filter((tag) => tag.end <= ref.start).reduce((sum, tag) => sum + tag.path.length - (tag.end - tag.start), 0);
    next.push({ ...ref, start: ref.start + shift, end: ref.end + shift });
  }
  return { content: result, references: next.sort((a, b) => a.start - b.start) };
}
