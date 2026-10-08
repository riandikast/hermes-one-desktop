import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { I18nProvider } from "../components/I18nProvider";

/**
 * Render a component that calls `useI18n`.
 *
 * WHY THIS EXISTS: `useI18n` THROWS outside an I18nProvider rather than falling
 * back, so any component that reads a translated string can no longer be
 * rendered bare in a test. The chat readers (last-prompt chip, pinned-message
 * reader) were moved onto i18n keys, which made every existing bare `render()`
 * of them fail with "useI18n must be used within I18nProvider".
 *
 * Wrapping here keeps the provider out of every individual test body and gives
 * one place to change if the i18n boundary moves.
 */
export function renderWithI18n(ui: ReactElement): RenderResult {
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <I18nProvider>{children}</I18nProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
