// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { highlightSegments } from "./HighlightedText";

/**
 * The prompt/message dialogs colour a few PROSE-relevant tokens for
 * readability. The colours are CSS and unverifiable in jsdom, but the token
 * BOUNDARIES are the part that can silently break (and would either recolour
 * ordinary prose or drop the highlighting entirely). Pin the boundaries.
 *
 * The invariant that matters most: highlighting must never LOSE text. A
 * read-only reader that drops characters is worse than one without colour.
 */

/** Reassemble the segments and assert nothing was lost or reordered. */
function textOf(text: string): string {
  return highlightSegments(text)
    .map((s) => s.text)
    .join("");
}

/** The class assigned to the segment whose text is exactly `needle`. */
function clsOf(text: string, needle: string): string | undefined {
  return highlightSegments(text).find((s) => s.text === needle)?.cls;
}

describe("highlightSegments", () => {
  it("never loses or reorders text", () => {
    const samples = [
      "plain prompt with no tokens at all",
      "see https://example.com/docs for details",
      "run `npm test` then check src/main/foo.ts",
      "# Heading\n- bullet\n1. numbered",
      "",
      "a".repeat(5000),
      "quote \"something long here\" and 'single'",
      "```ts\nconst x = 1;\n```",
      "KEY=value and --verbose",
      "mixed https://a.b/c `code` - list # head --flag PATH=/x/y",
    ];
    for (const s of samples) {
      expect(textOf(s), s).toBe(s);
    }
  });

  it("marks a URL", () => {
    expect(
      clsOf("see https://example.com/x now", "https://example.com/x"),
    ).toBe("hl-url");
  });

  it("marks an inline code span", () => {
    expect(clsOf("run `npm test` now", "`npm test`")).toBe("hl-code");
  });

  it("marks a heading only at line start", () => {
    expect(clsOf("## Plan\nbody", "## Plan")).toBe("hl-heading");
    // The same text mid-line is not a heading.
    expect(clsOf("text ## Plan", "## Plan")).toBeUndefined();
  });

  it("marks a bullet opener only at line start", () => {
    expect(clsOf("- item one", "- ")).toBe("hl-bullet");
    expect(clsOf("1. item", "1. ")).toBe("hl-bullet");
    // A hyphen inside a sentence is not a bullet.
    expect(clsOf("well - kind of", "- ")).toBeUndefined();
  });

  it("marks a quoted string", () => {
    expect(clsOf('say "hello there"', '"hello there"')).toBe("hl-quote");
  });

  it("marks a path and a long flag", () => {
    expect(clsOf("open src/main/foo.ts", "src/main/foo.ts")).toBe("hl-path");
    expect(clsOf("pass --verbose too", "--verbose")).toBe("hl-path");
  });

  it("marks a KEY=value pair", () => {
    expect(clsOf("set HERMES_HOME=/x", "HERMES_HOME=/x")).toBe("hl-env");
  });

  it("leaves ordinary prose unmarked", () => {
    // No token should appear in a plain sentence — over-highlighting makes text
    // HARDER to read, which is the opposite of the request.
    const segs = highlightSegments("just a normal sentence about the app");
    expect(segs.every((s) => s.cls === "")).toBe(true);
  });

  it("returns a single plain segment for empty input", () => {
    expect(highlightSegments("")).toEqual([]);
  });
});
