import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  THEMES,
  THEME_STORAGE_KEY as STORAGE_KEY,
} from "../constants";
import {
  applyCustomThemeStyles,
  isBuiltinTheme,
  loadCustomThemes,
  saveCustomThemes,
  themeAppearance,
  type CustomThemeStore,
} from "../theme/themeEditor";

const THEME_APPEARANCE = new Map(THEMES.map((t) => [t.id, t.appearance]));

/** "system" follows the OS preference; any other value is a theme id. */
type Theme = "system" | string;

interface ThemeContextValue {
  /** The user's selection: "system" or a specific theme id. */
  theme: Theme;
  /** The theme id actually applied to <html> (never "system"). */
  resolved: string;
  setTheme: (theme: Theme) => void;
  /** Whether corners are rounded (radius tokens) or squared off (0). */
  rounded: boolean;
  setRounded: (rounded: boolean) => void;
  /** User theme overrides/creations, kept in sync with the editor UI. */
  customThemes: CustomThemeStore;
  /** Create or update a custom theme entry (sparse vars over the base). */
  saveCustomTheme: (id: string, entry: CustomThemeStore[string]) => void;
  /** Remove a custom theme (built-in override or user creation). */
  deleteCustomTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: DEFAULT_DARK_THEME,
  setTheme: () => {},
  rounded: true,
  setRounded: () => {},
  customThemes: {},
  saveCustomTheme: () => {},
  deleteCustomTheme: () => {},
});

const THEME_IDS = new Set(THEMES.map((t) => t.id));
const RADIUS_STORAGE_KEY = "hermes-rounded";

function getSystemTheme(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? DEFAULT_DARK_THEME
    : DEFAULT_LIGHT_THEME;
}

function resolve(theme: Theme): string {
  return theme === "system" ? getSystemTheme() : theme;
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [customThemes, setCustomThemes] = useState<CustomThemeStore>(
    () => loadCustomThemes(),
  );
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // A stored id may be a custom theme not present in the static THEMES
    // registry — accept it if it exists in the custom store too.
    if (
      stored === "system" ||
      (stored && (THEME_IDS.has(stored) || stored in loadCustomThemes()))
    ) {
      return stored;
    }
    return DEFAULT_DARK_THEME;
  });
  const [resolved, setResolved] = useState<string>(() => resolve(theme));
  const [rounded, setRoundedState] = useState<boolean>(
    () => localStorage.getItem(RADIUS_STORAGE_KEY) !== "false",
  );

  function setTheme(next: Theme): void {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  function setRounded(next: boolean): void {
    setRoundedState(next);
    localStorage.setItem(RADIUS_STORAGE_KEY, String(next));
  }

  const saveCustomTheme = useCallback(
    (id: string, entry: CustomThemeStore[string]): void => {
      setCustomThemes((prev) => {
        const next = { ...prev, [id]: entry };
        saveCustomThemes(next);
        return next;
      });
    },
    [],
  );

  const deleteCustomTheme = useCallback((id: string): void => {
    setCustomThemes((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      saveCustomThemes(next);
      return next;
    });
  }, []);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(): void {
      if (theme === "system") {
        setResolved(getSystemTheme());
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Update resolved whenever theme changes
  useEffect(() => {
    setResolved(resolve(theme));
  }, [theme]);

  // Apply data-theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // Inject/refresh the custom-theme override stylesheet. Runs on mount and
  // after every editor mutation so edits apply live across the whole window.
  useEffect(() => {
    applyCustomThemeStyles(customThemes);
  }, [customThemes]);

  // Keep the native window appearance (macOS vibrancy material tone) in step
  // with the theme. "System" passes through so its prefers-color-scheme still
  // follows the OS; an explicit theme forces its own appearance so the sidebar
  // material matches it instead of the OS setting. Custom themes carry their
  // own appearance (defaulting dark).
  useEffect(() => {
    const source =
      theme === "system"
        ? "system"
        : (THEME_APPEARANCE.get(resolved) ??
          (isBuiltinTheme(resolved)
            ? undefined
            : themeAppearance(resolved, customThemes)));
    void window.hermesAPI?.setNativeAppearance?.(source ?? "dark");
  }, [theme, resolved, customThemes]);

  // Apply data-radius attribute to <html> ("none" squares off all corners)
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-radius",
      rounded ? "default" : "none",
    );
  }, [rounded]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolved,
        setTheme,
        rounded,
        setRounded,
        customThemes,
        saveCustomTheme,
        deleteCustomTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
