import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test as it } from "node:test";

const expect = (value) => ({
  toContain: (part) => assert.ok(value.includes(part), part),
  toMatch: (pattern) => assert.match(value, pattern),
});

// @lat: [[provider-setup#Provider setup#Flat theme-aware surfaces]]
it("matches Auxiliary's surface hierarchy without translucent section wrappers", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  assert.ok(css.length > 1000);
  const section = css.match(
    /\.providers-page \.provider-settings-panel > \.settings-section \{([^}]+)\}/,
  )[1];
  assert.match(section, /background:\s*transparent/);
  const surfaces = [
    "settings-key-list",
    "provider-summary",
    "settings-pool-group",
    "provider-config-card",
    "provider-key-card",
    "provider-add-card",
    "settings-pool-add",
  ];
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  for (const surface of surfaces) {
    const rule = rules.find(
      ([, selector, body]) =>
        selector.includes(`.${surface}`) && /background:/.test(body),
    );
    assert.ok(rule, surface);
    assert.match(rule[2], /background:\s*var\(--bg-secondary\)/, surface);
  }
  assert.match(
    css,
    /\.providers-page \.provider-settings-panel \.provider-summary\s*\{[^}]*flex-wrap:\s*wrap/,
  );
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
