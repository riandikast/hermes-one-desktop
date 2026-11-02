import { useCallback, useSyncExternalStore } from "react";

export type FontSizeStep = "small" | "default" | "large" | "xlarge";

/**
 * Text-only scale steps. Every `font-size` in the app CSS is multiplied by
 * `--font-scale`, so picking a step resizes text without touching padding,
 * icons, or the layout grid — unlike the whole-window Ctrl+wheel zoom.
 * 1 = the shipped type sizes (the default look).
 */
export const FONT_SIZE_STEPS: readonly {
  value: FontSizeStep;
  scale: number;
}[] = [
  { value: "small", scale: 0.9 },
  { value: "default", scale: 1 },
  { value: "large", scale: 1.15 },
  { value: "xlarge", scale: 1.3 },
];

const STORAGE_KEY = "hermes.fontSize";
const CHANGE_EVENT = "hermes-font-size-changed";
const CSS_VAR = "--font-scale";

export function scaleForStep(step: FontSizeStep): number {
  return FONT_SIZE_STEPS.find((option) => option.value === step)?.scale ?? 1;
}

function isStep(value: string | null): value is FontSizeStep {
  return FONT_SIZE_STEPS.some((option) => option.value === value);
}

export function readFontSizeStep(): FontSizeStep {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isStep(stored) ? stored : "default";
  } catch {
    return "default";
  }
}

/** Push the step's scale onto `:root`; CSS `calc()` picks it up immediately. */
export function applyFontScale(step: FontSizeStep): void {
  document.documentElement.style.setProperty(
    CSS_VAR,
    String(scaleForStep(step)),
  );
}

/** Boot hook: apply the stored size before the first paint. */
export function applyStoredFontScale(): void {
  applyFontScale(readFontSizeStep());
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useFontSize(): readonly [
  FontSizeStep,
  (step: FontSizeStep) => boolean,
] {
  const step = useSyncExternalStore(
    subscribe,
    readFontSizeStep,
    (): FontSizeStep => "default",
  );
  const setStep = useCallback((next: FontSizeStep): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
      applyFontScale(next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }, []);
  return [step, setStep];
}
