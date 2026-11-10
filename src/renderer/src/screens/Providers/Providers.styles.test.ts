import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { it } from "vitest";

const expect = (value: string) => ({
  toContain: (part: string) => assert.ok(value.includes(part), part),
  toMatch: (pattern: RegExp) => assert.match(value, pattern),
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
  )?.[1];
  assert.ok(section, "section wrapper rule");
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

// @lat: [[provider-setup#Provider setup#Inset native and custom carets]]
it("insets native and custom carets within Providers, restores forced colors", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  const native = css.match(
    /\.providers-page select\.input:not\(\[multiple\]\) \{([^}]+)\}/,
  )?.[1];
  assert.ok(native, "native caret rule");
  expect(native).toContain("appearance: none");
  expect(native).toContain("padding-inline: 12px 40px");
  expect(native).toContain("background-position: right 14px center");
  const custom = css.match(
    /\.providers-page \.model-select-modal \.logo-select-trigger \{([^}]+)\}/,
  )?.[1];
  assert.ok(custom, "custom caret rule");
  expect(custom).toContain("padding-inline: 12px 14px");
  expect(css).toMatch(
    /@media \(forced-colors: active\)[\s\S]*appearance: auto/,
  );
  expect(css).toContain("@media (max-width: 720px)");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
});

// @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
it("bounds provider dialogs with a shrinking scroll body and fixed controls", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  assert.ok(css.length > 1000);
  const modalRule = css.match(/\.providers-page \.models-modal \{([^}]+)\}/)?.[1];
  assert.ok(modalRule, "modal bounding rule");
  assert.match(modalRule, /max-height: calc\(100dvh - 100px\)/);
  assert.match(modalRule, /display: flex/);
  assert.match(modalRule, /flex-direction: column/);
  assert.match(modalRule, /overflow: hidden/);

  const bodyRule = css.match(
    /\.providers-page \.models-modal \.models-modal-body \{([^}]+)\}/,
  )?.[1];
  assert.ok(bodyRule, "body scroll rule");
  assert.match(bodyRule, /flex: 1 1 auto/);
  assert.match(bodyRule, /min-height: 0/);
  assert.match(bodyRule, /overflow-y: auto/);

  assert.match(
    css,
    /:is\(\.models-modal-header, \.models-modal-footer\) \{\s*flex-shrink: 0/,
  );
});

// @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
it("bounds every dialog on the page, not just the providers tabpanel", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  // The Auxiliary tab renders its tabpanel WITHOUT `.provider-settings-panel`,
  // so scoping the bounding rules to that class left its dialog unbounded:
  // taller than the window, clipped by `overflow: hidden`, and its body could
  // not scroll — the lower inputs were unreachable.
  for (const selector of [
    ".providers-page .models-modal-overlay {",
    ".providers-page .models-modal {",
    ".providers-page .models-modal .models-modal-body {",
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.ok(
    !/\.providers-page\s+\.provider-settings-panel\s+\.models-modal[-\s{]/.test(
      css,
    ),
    "dialog rules must not be scoped to the tabpanel",
  );
});

// @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
it("scrolls the overlay and never lets the key field collapse", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  // A dialog taller than the window must be reachable by scrolling the overlay;
  // centring it in a fixed, non-scrolling overlay clipped both ends.
  const overlay = css.match(
    /\.providers-page \.models-modal-overlay \{([^}]+)\}/,
  )?.[1];
  assert.ok(overlay, "overlay rule");
  assert.match(overlay, /align-items:\s*flex-start/);
  assert.match(overlay, /overflow-y:\s*auto/);

  const modal = css.match(/\.providers-page \.models-modal \{([^}]+)\}/)?.[1];
  assert.ok(modal, "modal rule");
  assert.match(modal, /margin-block:\s*auto/);

  // `.models-modal { width: 440px }` is declared later in main.css and beat the
  // 560px `.provider-modal` width, so every provider dialog rendered cramped.
  const width = css.match(
    /\.providers-page \.models-modal\.provider-modal \{([^}]+)\}/,
  )?.[1];
  assert.ok(width, "provider dialog width rule");
  assert.match(width, /width:\s*560px/);

  // `flex: 1` on a zero basis let the input shrink to nothing while the
  // Show/Replace links kept their width — a dialog you could not type into.
  const field = css.match(
    /\.providers-page \.models-modal \.provider-key-field \{([^}]+)\}/,
  )?.[1];
  assert.ok(field, "key field rule");
  assert.match(field, /flex-wrap:\s*nowrap/);

  const input = css.match(
    /\.providers-page \.models-modal \.provider-key-input,\s*\n?\.providers-page \.models-modal \.provider-key-masked \{([^}]+)\}/,
  )?.[1];
  assert.ok(input, "key input rule");
  assert.match(input, /flex:\s*1 1 14ch/);
});

// @lat: [[provider-setup#Provider setup#Viewport-bounded provider dialogs]]
it("lets the model picker's provider dropdown escape the bounded modal", () => {
  const css = readFileSync(
    "src/renderer/src/screens/Providers/Providers.css",
    "utf8",
  );
  const optOut = css.match(
    /\.providers-page \.models-modal\.model-select-modal,[\s\S]*?\{([^}]+)\}/,
  )?.[1];
  assert.ok(optOut, "model-select opt-out rule");
  assert.match(optOut, /overflow: visible/);
  // Declared AFTER the generic body rule, or the body's `overflow-y: auto`
  // would clip the menu back to a cut-off list.
  assert.ok(
    css.indexOf(".providers-page .models-modal.model-select-modal,") >
      css.indexOf(".providers-page .models-modal .models-modal-body {"),
    "opt-out must follow the generic body rule",
  );

  const main = readFileSync("src/renderer/src/assets/main.css", "utf8");
  assert.match(
    main,
    /\.models-modal\.model-select-modal \{[\s\S]*?overflow: visible/,
  );
});
