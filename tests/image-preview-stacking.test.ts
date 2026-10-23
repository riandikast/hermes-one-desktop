import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync("src/renderer/src/assets/main.css", "utf8");

// @lat: [[chat-performance#Image preview stacking]]
it("places body-portaled image previews on the existing global modal layer above tab chrome", () => {
  expect(css.length).toBeGreaterThan(1000);
  const z = (selector: string) => {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    return Number(block.match(/z-index:\s*(\d+)/)?.[1]);
  };
  expect(z(".chat-image-preview-backdrop")).toBe(z(".models-modal-overlay"));
  expect(z(".chat-image-preview-backdrop")).toBeGreaterThan(1002);
});
