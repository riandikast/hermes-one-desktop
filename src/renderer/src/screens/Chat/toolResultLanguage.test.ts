import { describe, expect, it } from "vitest";
import {
  detectOutputLanguage,
  languageForReadResult,
  languageFromPath,
  normaliseGrammar,
} from "./toolResultLanguage";

describe("languageFromPath", () => {
  it("maps common extensions", () => {
    expect(languageFromPath("src/a.ts")).toBe("typescript");
    expect(languageFromPath("src/a.tsx")).toBe("tsx");
    expect(languageFromPath("src/a.js")).toBe("javascript");
    expect(languageFromPath("lib/main.dart")).toBe("dart");
    expect(languageFromPath("app/MainActivity.kt")).toBe("kotlin");
    expect(languageFromPath("style.css")).toBe("css");
    expect(languageFromPath("pubspec.yaml")).toBe("yaml");
    expect(languageFromPath("data.json")).toBe("json");
  });

  it("handles WINDOWS backslash paths from real read_file calls", () => {
    // Taken verbatim from a real call: the path arrived fully backslashed.
    const real =
      "C:\\\\Users\\\\riand\\\\AndroidStudioProjects\\\\GeloraAppFlutter\\\\lib\\\\screens\\\\lhm\\\\form\\\\form_lhm.dart";
    expect(languageFromPath(real)).toBe("dart");
  });

  it("is case-insensitive about the extension", () => {
    expect(languageFromPath("MainActivity.KT")).toBe("kotlin");
    expect(languageFromPath("README.MD")).toBe("markdown");
  });

  it("recognises basenames with no useful extension", () => {
    expect(languageFromPath("/repo/Dockerfile")).toBe("docker");
    expect(languageFromPath("/repo/Makefile")).toBe("makefile");
    expect(languageFromPath("/repo/go.mod")).toBe("go");
    expect(languageFromPath("/repo/Cargo.toml")).toBe("toml");
    expect(languageFromPath("/repo/.gitignore")).toBe("git");
  });

  it("prefers the basename map over a misleading extension", () => {
    // .txt would otherwise send this to text.
    expect(languageFromPath("/repo/CMakeLists.txt")).toBe("cmake");
  });

  it("returns text for unknown, missing or malformed paths", () => {
    expect(languageFromPath("archive.unknownext")).toBe("text");
    expect(languageFromPath("no-extension")).toBe("text");
    expect(languageFromPath("trailing.")).toBe("text");
    expect(languageFromPath("")).toBe("text");
    expect(languageFromPath(null)).toBe("text");
    expect(languageFromPath(undefined)).toBe("text");
  });

  it("does not treat a dotfile as an extension", () => {
    // ".bashrc" must not resolve to ext "bashrc".
    expect(languageFromPath("/home/u/.bashrc")).toBe("text");
  });
});

describe("normaliseGrammar", () => {
  it("maps names that do not exist as prism keys", () => {
    // Verified against the bundled grammar list: `shell`, `sh` and `xml` are
    // absent, so an unaliased value would silently render unhighlighted.
    expect(normaliseGrammar("shell")).toBe("bash");
    expect(normaliseGrammar("sh")).toBe("bash");
    expect(normaliseGrammar("xml")).toBe("markup");
    expect(normaliseGrammar("html")).toBe("markup");
  });

  it("passes through names that do exist", () => {
    expect(normaliseGrammar("typescript")).toBe("typescript");
    expect(normaliseGrammar("dart")).toBe("dart");
    expect(normaliseGrammar("bash")).toBe("bash");
  });

  it("is case-insensitive", () => {
    expect(normaliseGrammar("Shell")).toBe("bash");
  });
});

describe("detectOutputLanguage", () => {
  it("detects a pretty-printed JSON object", () => {
    expect(detectOutputLanguage('{\n  "name": "hermes",\n  "ok": true\n}')).toBe(
      "json",
    );
  });

  it("detects a JSON array", () => {
    expect(detectOutputLanguage('[1, 2, 3]')).toBe("json");
  });

  it("does NOT call ordinary log output a shell language", () => {
    // The critical negative case: log text must stay "text" so TerminalOutput's
    // semantic colouring (errors, pass/fail) keeps working. A bash grammar here
    // would highlight "build" or "src" as keywords and mislead.
    const log = [
      "npm run build",
      "> hermes-desktop@0.7.4 build",
      "✓ built in 20.45s",
      "src/a.ts 2.45 kB",
    ].join("\n");
    expect(detectOutputLanguage(log)).toBe("text");
  });

  it("leaves test-summary output as text", () => {
    expect(
      detectOutputLanguage(" Test Files  1 failed | 47 passed (48)\n Tests  2 failed"),
    ).toBe("text");
  });

  it("leaves a diff as text so diff colouring still applies", () => {
    expect(
      detectOutputLanguage("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new"),
    ).toBe("text");
  });

  it("handles empty and whitespace-only output", () => {
    expect(detectOutputLanguage("")).toBe("text");
    expect(detectOutputLanguage("   \n  ")).toBe("text");
  });

  it("treats brace-wrapped non-JSON as text", () => {
    expect(detectOutputLanguage("{not json at all}")).toBe("text");
  });

  it("does not misdetect a multi-line log that happens to end in a brace", () => {
    expect(
      detectOutputLanguage("starting up\nloading config\n{ done }"),
    ).toBe("text");
  });
});

describe("languageForReadResult", () => {
  it("derives the language from the call's file path", () => {
    expect(languageForReadResult("C:\\proj\\lib\\main.dart")).toBe("dart");
    expect(languageForReadResult("/proj/src/app.tsx")).toBe("tsx");
  });

  it("falls back to text when the path is unknown", () => {
    // No content sniffing on purpose: guessing a source language from the text
    // is wrong often enough that it is worse than plain rendering.
    expect(languageForReadResult(null)).toBe("text");
    expect(languageForReadResult(undefined)).toBe("text");
  });
});
