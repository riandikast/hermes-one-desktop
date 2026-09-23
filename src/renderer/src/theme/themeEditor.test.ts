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
      empty: { name: "E", appearance: "dark", vars: {} },
    });
    expect(css).toContain('[data-theme="dracula"]');
    expect(css).toContain("--accent: #f00;");
    expect(css).not.toContain('[data-theme="empty"]');
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
