import { describe, expect, it, beforeEach } from "vitest";
import {
  applyCustomThemeStyles,
  customThemesCss,
  emptyVars,
  isBuiltinTheme,
  listThemes,
  loadCustomThemes,
  saveCustomThemes,
  seedCustomFrom,
  THEME_VAR_LABELS,
  THEME_VAR_ORDER,
  themeAppearance,
  themeIdFromName,
  themeName,
  themeVars,
  type CustomThemeStore,
} from "./themeEditor";

const SETTINGS_VARS = [
  "--settings-bg",
  "--settings-sidebar-bg",
  "--settings-card-bg",
  "--settings-field-bg",
  "--settings-hover-bg",
  "--settings-text",
  "--settings-text-secondary",
  "--settings-border",
];

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("themeEditor — built-in parsing", () => {
  it("parses all 13 built-in themes from main.css", () => {
    const store: CustomThemeStore = {};
    const themes = listThemes(store);
    expect(themes).toHaveLength(13);
    expect(themes.map((t) => t.id)).toContain("dracula");
    expect(themes.map((t) => t.id)).toContain("tokyo-night");
  });

  it("every built-in defines the full canonical variable set", () => {
    const store: CustomThemeStore = {};
    for (const th of listThemes(store)) {
      for (const v of THEME_VAR_ORDER) {
        expect(th.vars[v], `${th.id} missing ${v}`).toBeTruthy();
      }
    }
  });

  it("canonical variable order matches the documented labels", () => {
    expect(THEME_VAR_ORDER[0]).toBe("--bg-primary");
    expect(THEME_VAR_ORDER).toContain("--accent");
    expect(THEME_VAR_ORDER).toContain("--selection");
    expect(Object.keys(THEME_VAR_LABELS)).toEqual(
      expect.arrayContaining(THEME_VAR_ORDER),
    );
  });

  it("classifies light built-ins correctly", () => {
    const store: CustomThemeStore = {};
    expect(themeAppearance("light", store)).toBe("light");
    expect(themeAppearance("github-light", store)).toBe("light");
    expect(themeAppearance("solarized-light", store)).toBe("light");
    expect(themeAppearance("dracula", store)).toBe("dark");
  });

  it("isBuiltinTheme distinguishes registry ids", () => {
    expect(isBuiltinTheme("nord")).toBe(true);
    expect(isBuiltinTheme("my-theme")).toBe(false);
  });
});

describe("themeEditor — Settings palette", () => {
  it("defines cycle-free defaults and brighter cards in every built-in", () => {
    for (const theme of listThemes({})) {
      for (const variable of SETTINGS_VARS) {
        expect(THEME_VAR_ORDER).toContain(variable);
        expect(theme.vars[variable], `${theme.id}: ${variable}`).toBeTruthy();
        expect(theme.vars[variable]).not.toContain("var(");
      }
      expect(luminance(theme.vars["--settings-card-bg"]), theme.id).toBeGreaterThan(
        luminance(theme.vars["--settings-bg"]),
      );
      if (theme.id !== "dark" && theme.id !== "light") {
        expect(theme.vars["--settings-bg"]).toBe(
          theme.vars[theme.appearance === "light" ? "--bg-secondary" : "--bg-primary"],
        );
        expect(theme.vars["--settings-card-bg"]).toBe(
          theme.vars[theme.appearance === "light" ? "--bg-primary" : "--bg-elevated"],
        );
        expect(theme.vars["--settings-text"]).toBe(theme.vars["--text-primary"]);
      }
    }
  });

  it("uses flattened PI dark and custom light palettes with readable text", () => {
    const palettes = {
      dark: ["#181818", "#000000", "#202020", "#212121", "#262626", "#ffffff", "#bababa", "#2a2a2a"],
      light: ["#f8fafc", "#eef2f6", "#ffffff", "#f1f5f9", "#e2e8f0", "#182230", "#526174", "#d7dfe8"],
    };
    for (const [id, palette] of Object.entries(palettes)) {
      const vars = themeVars(id, {})!;
      expect(SETTINGS_VARS.map((variable) => vars[variable])).toEqual(palette);
      for (const text of ["--settings-text", "--settings-text-secondary"]) {
        for (const bg of SETTINGS_VARS.slice(0, 5)) {
          const a = luminance(vars[text]);
          const b = luminance(vars[bg]);
          expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("backfills old custom palettes consistently without mutating storage", () => {
    const store: CustomThemeStore = {
      old: {
        name: "Old Light",
        appearance: "light",
        vars: {
          "--bg-primary": "#ffffff",
          "--bg-secondary": "#eeeeee",
          "--bg-tertiary": "#dddddd",
          "--text-primary": "#222222",
          "--settings-border": "#123456",
        },
      },
      darkOld: { name: "Old Dark", appearance: "dark", vars: {} },
    };
    saveCustomThemes(store);
    const loaded = loadCustomThemes();
    const vars = themeVars("old", loaded)!;
    expect(vars["--settings-bg"]).toBe("#eeeeee");
    expect(vars["--settings-card-bg"]).toBe("#ffffff");
    expect(vars["--settings-field-bg"]).toBe("#dddddd");
    expect(vars["--settings-text"]).toBe("#222222");
    expect(vars["--settings-hover-bg"]).toBe("#e2e8f0");
    expect(vars["--settings-border"]).toBe("#123456");
    for (const id of ["old", "darkOld"]) {
      const resolved = themeVars(id, loaded)!;
      expect(listThemes(loaded).find((theme) => theme.id === id)!.vars).toEqual(resolved);
      expect(seedCustomFrom(id, "copy", "Copy", loaded).vars).toEqual(resolved);
      for (const variable of SETTINGS_VARS) {
        expect(resolved[variable]).toBeTruthy();
        expect(customThemesCss(loaded)).toContain(`${variable}: ${resolved[variable]};`);
      }
    }
    expect(themeVars("darkOld", loaded)!["--settings-bg"]).toBe("#181818");
    expect(loadCustomThemes()).toEqual(store);
    localStorage.clear();
  });

  it("does not turn legacy palette aliases into cyclic Settings aliases", () => {
    const store: CustomThemeStore = {
      old: {
        name: "Aliases",
        appearance: "light",
        vars: { "--bg-primary": "var(--bg-secondary)", "--bg-secondary": "var(--settings-bg)" },
      },
    };
    const vars = themeVars("old", store)!;
    expect(vars["--settings-bg"]).toBe("#f8fafc");
    expect(vars["--settings-card-bg"]).toBe("#ffffff");
  });
});

describe("themeEditor — custom store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("themeVars merges built-in base with sparse overrides", () => {
    const store: CustomThemeStore = {
      dracula: {
        name: "Dracula",
        appearance: "dark",
        vars: { "--accent": "#ff0000" },
      },
    };
    const vars = themeVars("dracula", store)!;
    expect(vars["--accent"]).toBe("#ff0000"); // overridden
    expect(vars["--bg-primary"]).toBe("#282a36"); // base preserved
  });

  it("themeVars returns base values when no override exists", () => {
    const vars = themeVars("nord", {})!;
    expect(vars["--bg-primary"]).toBeTruthy();
  });

  it("themeVars returns null for unknown ids", () => {
    expect(themeVars("does-not-exist", {})).toBeNull();
  });

  it("round-trips through localStorage", () => {
    const store: CustomThemeStore = {
      "my-theme": {
        name: "My Theme",
        appearance: "light",
        vars: { "--bg-primary": "#fff" },
      },
    };
    saveCustomThemes(store);
    expect(loadCustomThemes()).toEqual(store);
  });

  it("loadCustomThemes drops malformed entries", () => {
    localStorage.setItem(
      "hermes-custom-themes",
      JSON.stringify({
        good: { name: "ok", appearance: "dark", vars: { "--accent": "#123456" } },
        bad: { nope: true },
      }),
    );
    const loaded = loadCustomThemes();
    expect(Object.keys(loaded)).toEqual(["good"]);
  });

  it("loadCustomThemes survives corrupt JSON", () => {
    localStorage.setItem("hermes-custom-themes", "{not json");
    expect(loadCustomThemes()).toEqual({});
  });

  it("listThemes appends user-created themes after built-ins", () => {
    const store: CustomThemeStore = {
      "my-theme": {
        name: "My Theme",
        appearance: "dark",
        vars: { "--bg-primary": "#010203" },
      },
    };
    const themes = listThemes(store);
    expect(themes).toHaveLength(14);
    expect(themes[13].id).toBe("my-theme");
    expect(themes[13].builtin).toBe(false);
    expect(themes[13].vars["--bg-primary"]).toBe("#010203");
  });

  it("themeName resolves custom names", () => {
    const store: CustomThemeStore = {
      "my-theme": { name: "My Theme", appearance: "dark", vars: {} },
    };
    expect(themeName("my-theme", store)).toBe("My Theme");
    expect(themeName("monokai", store)).toBe("Monokai");
  });

  it("seedCustomFrom copies the source palette", () => {
    const entry = seedCustomFrom("dracula", "copy", "Dracula Copy", {});
    expect(entry.name).toBe("Dracula Copy");
    expect(entry.appearance).toBe("dark");
    expect(entry.vars["--bg-primary"]).toBe("#282a36");
  });

  it("emptyVars covers the canonical order", () => {
    const vars = emptyVars();
    expect(Object.keys(vars)).toEqual(THEME_VAR_ORDER);
  });

  it("themeIdFromName slugifies and dedupes safely", () => {
    expect(themeIdFromName("My Cool Theme!")).toBe("my-cool-theme");
    expect(themeIdFromName("   ")).toMatch(/^custom-/);
    expect(themeIdFromName("a".repeat(80)).length).toBeLessThanOrEqual(48);
  });
});

describe("themeEditor — CSS injection", () => {
  it("generates override blocks for non-empty vars only", () => {
    const css = customThemesCss({
      dracula: { name: "D", appearance: "dark", vars: { "--accent": "#f00" } },
      nord: { name: "N", appearance: "dark", vars: {} },
    });
    expect(css).toContain('[data-theme="dracula"]');
    expect(css).toContain("--accent: #f00;");
    expect(css).not.toContain('[data-theme="nord"]');
  });

  it("applyCustomThemeStyles mounts one style tag and refreshes it", () => {
    document.head.innerHTML = "";
    applyCustomThemeStyles({
      dracula: { name: "D", appearance: "dark", vars: { "--accent": "#f00" } },
    });
    const el = document.getElementById("hermes-custom-themes-style");
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("--accent: #f00");

    applyCustomThemeStyles({});
    expect(
      document.querySelectorAll("#hermes-custom-themes-style"),
    ).toHaveLength(1);
    expect(
      document.getElementById("hermes-custom-themes-style")!.textContent,
    ).toBe("");
  });
});
