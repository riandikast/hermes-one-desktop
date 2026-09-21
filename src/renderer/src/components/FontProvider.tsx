import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_FONT,
  FONT_OPTIONS,
  FONT_STORAGE_KEY as STORAGE_KEY,
  SYSTEM_FONT_PREFIX,
} from "../constants";

interface FontContextValue {
  /** Stored value: a preset `FontOption.value`, or `system:<family>`. */
  font: string;
  setFont: (font: string) => void;
}

const FontContext = createContext<FontContextValue>({
  font: DEFAULT_FONT,
  setFont: () => {},
});

/** Build the family + sane fallback chain. */
export function buildFontStack(family: string): string {
  return `"${family.replace(/"/g, '\\"')}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
}

/**
 * Resolve a stored font value to a CSS `font-family` stack.
 *
 * `system:<family>` values come from the installed-font picker; every other
 * value is a built-in preset. An unknown value (e.g. a system font that has
 * since been uninstalled) falls back to the default preset rather than leaving
 * `--font-sans` unset.
 */
export function stackFor(font: string): string {
  if (font.startsWith(SYSTEM_FONT_PREFIX)) {
    const family = font.slice(SYSTEM_FONT_PREFIX.length).trim();
    if (family) return buildFontStack(family);
  }
  return (
    FONT_OPTIONS.find((opt) => opt.value === font)?.stack ??
    FONT_OPTIONS.find((opt) => opt.value === DEFAULT_FONT)!.stack
  );
}

/** A stored value is valid if it is a preset or a well-formed system family. */
function isKnownFont(value: string | null): value is string {
  if (!value) return false;
  if (value.startsWith(SYSTEM_FONT_PREFIX)) {
    return value.slice(SYSTEM_FONT_PREFIX.length).trim().length > 0;
  }
  return FONT_OPTIONS.some((opt) => opt.value === value);
}

export function FontProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [font, setFontState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isKnownFont(stored) ? stored : DEFAULT_FONT;
  });

  function setFont(next: string): void {
    setFontState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — applied for this session only */
    }
  }

  // Apply the chosen stack to --font-sans on <html>, overriding the CSS default.
  useEffect(() => {
    document.documentElement.style.setProperty("--font-sans", stackFor(font));
  }, [font]);

  return (
    <FontContext.Provider value={{ font, setFont }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont(): FontContextValue {
  return useContext(FontContext);
}
