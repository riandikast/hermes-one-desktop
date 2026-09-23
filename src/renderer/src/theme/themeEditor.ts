/**
 * Custom theme engine — lets users edit every CSS variable of any theme,
 * duplicate built-ins into new themes, and delete custom ones.
 *
 * How it works:
 *  - `main.css?raw` ships the stylesheet text to the renderer. The 13 built-in
 *    `[data-theme]` blocks are PARSED from it (single source of truth — adding
 *    a theme to main.css + constants.ts keeps working, no separate registry).
 *  - User overrides live in localStorage (`hermes-custom-themes`) keyed by
 *    theme id. A custom entry with the id of a built-in theme OVERRIDES that
 *    built-in's variables; an unknown id is a brand-new theme.
 *  - Overrides are injected as a `<style>` tag AFTER the main stylesheet, so
 *    `[data-theme="x"] { --accent: … }` wins the cascade without touching
 *    main.css on disk. Deleting a custom theme just drops its entry and
 *    re-injects; the original main.css values apply again.
 */

import mainCssRaw from "../assets/main.css?raw";
import fs from "node:fs";
import path from "node:path";

// In vite (dev + build) the ?raw import inlines the stylesheet. In the vitest
// jsdom environment the vite pipeline can return an empty string, so fall back
// to reading the file directly (works in tests and inside electron's asar).
function loadMainCss(): string {
  if (mainCssRaw && mainCssRaw.length > 0) return mainCssRaw;
  try {
    return fs.readFileSync(
      path.resolve(__dirname, "../assets/main.css"),
      "utf-8",
    );
  } catch {
    return "";
  }
}

const mainCss = loadMainCss();

export interface EditableTheme {
  id: string;
  name: string;
  /** Palette tone — drives native window material + "System" fallback. */
  appearance: "dark" | "light";
  /** CSS variable name (with leading `--`) → value string. */
  vars: Record<string, string>;
  /** True when this id comes from main.css rather than user storage. */
  builtin: boolean;
}

export const CUSTOM_THEMES_STORAGE_KEY = "hermes-custom-themes";

/** Canonical variable order (parsed from the dark theme block). */
export const THEME_VAR_ORDER: string[] = parseVarOrder(mainCss);

/** Human-readable labels for the known variables; unknown vars fall back. */
export const THEME_VAR_LABELS: Record<string, string> = {
  "--bg-primary": "Background primary",
  "--bg-secondary": "Background secondary",
  "--bg-tertiary": "Background tertiary",
  "--bg-elevated": "Background elevated",
  "--bg-hover": "Background hover",
  "--bg-active": "Background active",
  "--accent": "Accent",
  "--accent-hover": "Accent hover",
  "--accent-subtle": "Accent subtle",
  "--accent-text": "Accent text",
  "--primary-yellow": "Highlight yellow",
  "--text-primary": "Text primary",
  "--text-secondary": "Text secondary",
  "--text-muted": "Text muted",
  "--border": "Border",
  "--border-bright": "Border bright",
  "--border-focus": "Border focus",
  "--success": "Success",
  "--success-bg": "Success background",
  "--error": "Error",
  "--error-bg": "Error background",
  "--warning": "Warning",
  "--warning-bg": "Warning background",
  "--user-bubble": "User bubble",
  "--user-bubble-text": "User bubble text",
  "--agent-bubble": "Agent bubble",
  "--agent-bubble-text": "Agent bubble text",
  "--code-bg": "Code background",
  "--tool-result-bg": "Tool result background",
  "--scrollbar-thumb": "Scrollbar thumb",
  "--scrollbar-hover": "Scrollbar hover",
  "--selection": "Text selection",
};

function parseVarOrder(css: string): string[] {
  const block = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  if (!block) return [];
  const order: string[] = [];
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:/g)) {
    if (!order.includes(m[1])) order.push(m[1]);
  }
  return order;
}

function parseBuiltinThemes(css: string): EditableTheme[] {
  const themes: EditableTheme[] = [];
  const re = /\[data-theme="([\w-]+)"\]\s*\{([\s\S]*?)\n\}/g;
  for (const m of css.matchAll(re)) {
    const id = m[1];
    const vars: Record<string, string> = {};
    for (const v of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[v[1]] = v[2].trim();
    }
    themes.push({
      id,
      name: builtinDisplayName(id),
      appearance: lightBuiltins.has(id) ? "light" : "dark",
      vars,
      builtin: true,
    });
  }
  return themes;
}

const LIGHT_BUILTINS = new Set(["light", "github-light", "solarized-light"]);
const lightBuiltins = LIGHT_BUILTINS;

const BUILTIN_NAMES: Record<string, string> = {
  dark: "Dark",
  light: "Light",
  dracula: "Dracula",
  nord: "Nord",
  "one-dark": "One Dark",
  "vs-code": "VS Code",
  "github-dark": "GitHub Dark",
  monokai: "Monokai",
  "solarized-dark": "Solarized Dark",
  "gruvbox-dark": "Gruvbox Dark",
  "tokyo-night": "Tokyo Night",
  "github-light": "GitHub Light",
  "solarized-light": "Solarized Light",
};

function builtinDisplayName(id: string): string {
  return BUILTIN_NAMES[id] ?? id;
}

const BUILTINS = parseBuiltinThemes(mainCss);

/** Effective variables for a theme: built-in base, then user overrides. */
export function effectiveVars(
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  if (!overrides || Object.keys(overrides).length === 0) {
    // Fast path: nothing stored for this id.
    return {};
  }
  return overrides;
}

/** All selectable themes: built-ins first, then user-created ones. */
export function listThemes(custom: CustomThemeStore): EditableTheme[] {
  const out: EditableTheme[] = BUILTINS.map((b) => {
    const o = custom[b.id];
    return o
      ? { ...b, vars: { ...b.vars, ...o.vars }, builtin: true }
      : { ...b, vars: { ...b.vars } };
  });
  for (const [id, entry] of Object.entries(custom)) {
    if (!BUILTIN_NAMES[id]) {
      out.push({
        id,
        name: entry.name || id,
        appearance: entry.appearance ?? "dark",
        vars: { ...emptyVars(), ...entry.vars },
        builtin: false,
      });
    }
  }
  return out;
}

/** Variables for one theme id, resolved for live editing. */
export function themeVars(
  id: string,
  custom: CustomThemeStore,
): Record<string, string> | null {
  const builtin = BUILTINS.find((b) => b.id === id);
  const entry = custom[id];
  if (!builtin && !entry) return null;
  return { ...(builtin?.vars ?? emptyVars()), ...(entry?.vars ?? {}) };
}

export function emptyVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of THEME_VAR_ORDER) vars[name] = "";
  return vars;
}

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_NAMES[id] !== undefined;
}

export function themeName(id: string, custom: CustomThemeStore): string {
  if (isBuiltinTheme(id)) return builtinDisplayName(id);
  return custom[id]?.name ?? id;
}

export function themeAppearance(
  id: string,
  custom: CustomThemeStore,
): "dark" | "light" {
  if (isBuiltinTheme(id)) {
    return LIGHT_BUILTINS.has(id) ? "light" : "dark";
  }
  return custom[id]?.appearance ?? "dark";
}

export interface CustomThemeEntry {
  name: string;
  appearance: "dark" | "light";
  /** Only the OVERRIDDEN variables — sparse, so built-in values still apply. */
  vars: Record<string, string>;
}

export type CustomThemeStore = Record<string, CustomThemeEntry>;

export function loadCustomThemes(): CustomThemeStore {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CustomThemeStore;
    if (!parsed || typeof parsed !== "object") return {};
    // Drop malformed entries so one bad write can't brick the picker.
    const clean: CustomThemeStore = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.name === "string" &&
        entry.vars &&
        typeof entry.vars === "object"
      ) {
        clean[id] = {
          name: entry.name,
          appearance: entry.appearance === "light" ? "light" : "dark",
          vars: entry.vars,
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveCustomThemes(store: CustomThemeStore): void {
  localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(store));
}

/** Build the CSS text injected for all custom/overridden themes. */
export function customThemesCss(store: CustomThemeStore): string {
  const blocks: string[] = [];
  for (const [id, entry] of Object.entries(store)) {
    const vars = Object.entries(entry.vars)
      .filter(([, v]) => v && v.trim() !== "")
      .map(([name, v]) => `  ${name}: ${v};`)
      .join("\n");
    if (!vars) continue;
    blocks.push(`[data-theme="${cssEscapeId(id)}"] {\n${vars}\n}`);
  }
  return blocks.join("\n\n");
}

function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Ensure the override <style> tag exists and reflects `store`. Idempotent. */
export function applyCustomThemeStyles(store: CustomThemeStore): void {
  if (typeof document === "undefined") return;
  const id = "hermes-custom-themes-style";
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    // After the main stylesheet so overrides win the cascade.
    document.head.appendChild(el);
  }
  el.textContent = customThemesCss(store);
}

/** A fresh theme seeded from a source theme's current effective values. */
export function seedCustomFrom(
  sourceId: string,
  newId: string,
  newName: string,
  custom: CustomThemeStore,
): CustomThemeEntry {
  const vars = themeVars(sourceId, custom) ?? emptyVars();
  return {
    name: newName,
    appearance: themeAppearance(sourceId, custom),
    vars: { ...vars },
  };
}

/** Sanitize a user-entered theme name into a storage-safe id. */
export function themeIdFromName(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return id || `custom-${Date.now().toString(36)}`;
}
