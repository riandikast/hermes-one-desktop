import { describe, expect, it } from "vitest";
import { t, getLocaleDirection } from "./index";

describe("shared i18n", () => {
  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to Hermes One");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });

  it("returns zh-CN text when available", () => {
    expect(t("welcome.title", "zh-CN")).toBe("欢迎使用 Hermes");
  });

  it("returns zh-TW text when available", () => {
    expect(t("welcome.title", "zh-TW")).toBe("歡迎使用 Hermes");
  });

  it("returns es text when available", () => {
    expect(t("welcome.title", "es")).toBe("Bienvenido a Hermes");
  });

  it("returns id text when available", () => {
    expect(t("welcome.title", "id")).toBe("Selamat datang di Hermes");
  });

  it("returns pl text when available", () => {
    expect(t("welcome.title", "pl")).toBe("Witamy w Hermes");
  });

  it("returns he text when available", () => {
    expect(t("welcome.title", "he")).toBe("ברוכים הבאים ל-Hermes");
  });

  it("reports he as a right-to-left locale", () => {
    expect(getLocaleDirection("he")).toBe("rtl");
    expect(getLocaleDirection("en")).toBe("ltr");
  });

  it("falls back to en when zh-CN key is missing", () => {
    expect(t("nonExistent.fallbackKey", "zh-CN")).toBe(
      "nonExistent.fallbackKey",
    );
  });

  it("preserves interpolation placeholders in es", () => {
    expect(t("common.updateAvailable", "es", { version: "1.2.3" })).toBe(
      "Actualizar a v1.2.3",
    );
  });

  it("preserves interpolation placeholders in pl", () => {
    expect(t("common.updateAvailable", "pl", { version: "1.2.3" })).toBe(
      "Aktualizacja v1.2.3",
    );
  });
});

describe("reader keys fall back to English", () => {
  // The two message readers (last-prompt chip, pinned-message bar) use
  // `chat.reader.*`, which is translated in English only. The other locales
  // must resolve it from the English fallback rather than render the raw key
  // on screen — the source is `translated ?? fallback ?? key`.
  it("resolves a reader key in a locale that has no translation for it", () => {
    const value = t("chat.reader.showFull", "ja");
    expect(value).toBe("Show full");
    // The failure mode this guards: the key itself leaking into the UI.
    expect(value).not.toBe("chat.reader.showFull");
  });

  it("resolves the pinned dialog titles in a locale without them", () => {
    expect(t("chat.reader.pinnedYou", "ar")).toBe("Pinned — You");
    expect(t("chat.reader.messageLabel", "he")).toBe("Message");
  });

  it("interpolates count through the fallback", () => {
    expect(t("chat.reader.lastPromptsLabel", "ja", { count: 3 })).toBe(
      "Last 3 prompts",
    );
  });
});
