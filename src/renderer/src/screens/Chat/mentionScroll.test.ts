import { describe, expect, it } from "vitest";
import { scrollMentionItemIntoView, type Measurable, type Scrollable, type ScrollableRect } from "./mentionScroll";

function box(scrollTop: number, top: number, bottom: number): Scrollable & Measurable {
  return {
    scrollTop,
    getBoundingClientRect: (): ScrollableRect => ({ top, bottom }),
  };
}

function row(top: number, height: number): { getBoundingClientRect(): ScrollableRect } {
  return { getBoundingClientRect: (): ScrollableRect => ({ top, bottom: top + height }) };
}

describe("scrollMentionItemIntoView", () => {
  it("scrolls down just enough to reveal a row below the fold", () => {
    const menu = box(0, 0, 100);
    scrollMentionItemIntoView(menu, row(120, 20));
    // Row bottom (140) lands on the padded bottom edge (94).
    expect(menu.scrollTop).toBe(46);
  });

  it("scrolls up just enough to reveal a row above the fold", () => {
    const menu = box(200, 0, 100);
    scrollMentionItemIntoView(menu, row(-30, 20));
    // Row top (-30) lands on the padded top edge (6).
    expect(menu.scrollTop).toBe(164);
  });

  it("leaves an already-visible row untouched", () => {
    const menu = box(40, 0, 100);
    scrollMentionItemIntoView(menu, row(50, 20));
    expect(menu.scrollTop).toBe(40);
  });

  it("honours the padding band at both edges", () => {
    const down = box(0, 0, 100);
    scrollMentionItemIntoView(down, row(85, 20), 10);
    expect(down.scrollTop).toBe(15); // 105 vs padded bottom 90

    const up = box(50, 0, 100);
    scrollMentionItemIntoView(up, row(2, 20), 10);
    expect(up.scrollTop).toBe(42); // 2 vs padded top 10
  });
});
