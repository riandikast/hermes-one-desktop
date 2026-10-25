// @ts-expect-error -- Node-only test; web tsconfig intentionally excludes Node types.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("anchors tools below an unchanged normal-flow trigger without clipping popovers", () => {
  const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
  expect(css.length).toBeGreaterThan(1000);
  const rules = [...css.matchAll(/\.speed-dial-items\s*\{([^}]+)\}/g)].map((match) => match[1]);
  expect(rules[0]).toContain("position: absolute");
  expect(rules[0]).toContain("top: calc(100% + 6px)");
  expect(rules.join("")).not.toMatch(/overflow:\s*hidden|max-height/);
});
