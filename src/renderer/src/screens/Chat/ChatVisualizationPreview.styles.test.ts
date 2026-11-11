import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/src/assets/main.css", "utf8");

describe("visualization rail styles", () => {
  it("shares the tool-preview rail and lets the frame fill it", () => {
    expect(css).toMatch(
      /\.visualization-preview-body\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/,
    );
    expect(css).toMatch(
      /\.visualization-preview-frame\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*border:\s*0;/,
    );
  });

  it("keeps the header and its controls inside the rail", () => {
    expect(css).toMatch(
      /\.visualization-preview-header\s*\{[^}]*display:\s*flex;[^}]*flex-shrink:\s*0;/,
    );
    expect(css).toMatch(
      /\.visualization-preview-title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/,
    );
    expect(css).toMatch(/\.visualization-preview-switch,[\s\S]*?\.tool-file-preview-switch\s*\{/);
  });
});
