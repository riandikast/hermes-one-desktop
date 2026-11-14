import { expect, it } from "vitest";
import { registerKnowledgeTags } from "./knowledgeTaggedPaths";
import { MENTION_START, MENTION_SEP, MENTION_END } from "../Chat/mention";

it("registers every pasted mention tag, shifts existing spans and leaves prose paths alone", () => {
  const tag = `${MENTION_START}code.ts${MENTION_SEP}C:/project/code.ts${MENTION_END}`;
  const content = `${tag} then ${tag} plain C:/literal.ts`;
  const start = content.indexOf("C:/literal.ts");
  const result = registerKnowledgeTags(content, [{ start, end: content.length, text: "C:/literal.ts", path: "C:/literal.ts" }]);
  expect(result.content).toBe("C:/project/code.ts then C:/project/code.ts plain C:/literal.ts");
  expect(result.references).toHaveLength(3);
  for (const ref of result.references) expect(result.content.slice(ref.start, ref.end)).toBe(ref.path);
  expect(registerKnowledgeTags("plain C:/literal.ts", []).references).toEqual([]);
});
