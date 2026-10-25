import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test as it } from "node:test";

const expect = (value) => ({
  toContain: (part) => assert.ok(value.includes(part), part),
  toMatch: (pattern) => assert.match(value, pattern),
});

it("insets native and custom carets within Providers, restores forced colors", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  const native = css.match(
    /\.providers-page select\.input:not\(\[multiple\]\) \{([^}]+)\}/,
  )[1];
  expect(native).toContain("appearance: none");
  expect(native).toContain("padding-inline: 12px 40px");
  expect(native).toContain("background-position: right 14px center");
  const custom = css.match(
    /\.providers-page \.model-select-modal \.logo-select-trigger \{([^}]+)\}/,
  )[1];
  expect(custom).toContain("padding-inline: 12px 14px");
  expect(css).toMatch(
    /@media \(forced-colors: active\)[\s\S]*appearance: auto/,
  );
  expect(css).toContain("@media (max-width: 720px)");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
});
