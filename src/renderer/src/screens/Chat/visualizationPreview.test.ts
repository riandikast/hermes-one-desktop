import { describe, expect, it } from "vitest";
import {
  buildVisualizationDocument,
  chooseSidePreview,
  extractInlineVisualization,
  visualizationTitle,
  VISUALIZATION_MAX_BYTES,
} from "./visualizationPreview";

const reply = (fence: string): string =>
  `Here is the result.\n\n${fence}\n\nThat is all.`;

describe("extractInlineVisualization", () => {
  it("reads the fenced HTML body and its title", () => {
    const found = extractInlineVisualization(
      reply("```html\n<title>Sales</title><div>42</div>\n```"),
    );
    expect(found).toEqual({
      html: "<title>Sales</title><div>42</div>",
      title: "Sales",
      complete: true,
    });
  });

  it("uses the last HTML fence when a reply revises it", () => {
    const content = [
      "```html",
      "<h1>First</h1>",
      "```",
      "changed my mind",
      "```html",
      "<h1>Second</h1>",
      "```",
    ].join("\n");
    expect(extractInlineVisualization(content)).toMatchObject({
      html: "<h1>Second</h1>",
      title: "Second",
    });
  });

  it("ignores non-HTML fences", () => {
    expect(
      extractInlineVisualization(reply("```js\nconsole.log('x')\n```")),
    ).toBeNull();
  });

  it("returns an unterminated fence as incomplete instead of nothing", () => {
    expect(extractInlineVisualization("```html\n<h1>Building</h1>")).toMatchObject(
      { html: "<h1>Building</h1>", complete: false },
    );
  });

  it("refuses a fragment over the size cap", () => {
    const huge = "x".repeat(VISUALIZATION_MAX_BYTES + 1);
    expect(extractInlineVisualization(`\`\`\`html\n${huge}\n\`\`\``)).toBeNull();
  });

  it("supports tilde fences and case-insensitive languages", () => {
    expect(
      extractInlineVisualization("~~~HTML\n<h2>Chart</h2>\n~~~"),
    ).toMatchObject({ html: "<h2>Chart</h2>", title: "Chart" });
  });
});

describe("visualizationTitle", () => {
  it("falls back to a generic label", () => {
    expect(visualizationTitle("<div>plain</div>")).toBe("Visualization");
  });

  it("strips markup and collapses whitespace", () => {
    expect(visualizationTitle("<h1>  <span>Hello</span>\n world </h1>")).toBe(
      "Hello world",
    );
  });
});

describe("chooseSidePreview", () => {
  it("defaults to files while a turn runs, then the visualization", () => {
    expect(chooseSidePreview(null, true, true)).toBe("files");
    expect(chooseSidePreview(null, false, true)).toBe("visualization");
    expect(chooseSidePreview(null, true, false)).toBe("files");
    expect(chooseSidePreview(null, false, false)).toBeNull();
  });

  it("keeps an explicit pick while that surface exists", () => {
    expect(chooseSidePreview("visualization", true, true)).toBe("visualization");
    expect(chooseSidePreview("files", true, true)).toBe("files");
  });

  it("falls back when the picked surface disappears", () => {
    expect(chooseSidePreview("visualization", true, false)).toBe("files");
    expect(chooseSidePreview("files", false, true)).toBe("visualization");
    expect(chooseSidePreview("files", false, false)).toBeNull();
  });
});

describe("buildVisualizationDocument", () => {
  it("locks the guest down to inline assets and no network", () => {
    const doc = buildVisualizationDocument("<p>hi</p>", {}, true);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).toContain('<meta name="color-scheme" content="dark">');
    expect(doc).toContain("<p>hi</p>");
  });

  it("passes only theme variables and applies the light scheme", () => {
    const doc = buildVisualizationDocument(
      "<p>hi</p>",
      { "--bg-primary": "#f8fafc", "not-a-var": "red" },
      false,
    );
    expect(doc).toContain("--bg-primary:#f8fafc;");
    expect(doc).not.toContain("not-a-var");
    expect(doc).toContain('<meta name="color-scheme" content="light">');
  });
});
