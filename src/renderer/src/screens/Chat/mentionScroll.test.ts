import { describe, expect, it } from "vitest";
import { scrollMentionItemIntoView, type MentionScrollBox } from "./mentionScroll";

function box(scrollTop: number, clientHeight = 100, scrollHeight = 1000): MentionScrollBox {
  return { scrollTop, clientHeight, scrollHeight };
}

function row(offsetTop: number, offsetHeight: number): { offsetTop: number; offsetHeight: number } {
  return { offsetTop, offsetHeight };
}

describe("scrollMentionItemIntoView", () => {
  it("scrolls down just enough to reveal a row below the fold", () => {
    const menu = box(0);
    scrollMentionItemIntoView(menu, row(120, 20));
    // Row bottom (140) plus padding lands on the 100px box bottom.
    expect(menu.scrollTop).toBe(46);
  });

  it("scrolls up just enough to reveal a row above the fold", () => {
    const menu = box(400);
    scrollMentionItemIntoView(menu, row(150, 20));
    // Row top (150) minus padding becomes the new scroll offset.
    expect(menu.scrollTop).toBe(144);
  });

  it("leaves an already-visible row untouched", () => {
    const menu = box(40);
    scrollMentionItemIntoView(menu, row(50, 20));
    expect(menu.scrollTop).toBe(40);
  });

  it("honours the padding band at both edges", () => {
    const down = box(0);
    scrollMentionItemIntoView(down, row(85, 20), 10);
    expect(down.scrollTop).toBe(15); // 115 vs padded bottom 90

    const up = box(50);
    scrollMentionItemIntoView(up, row(2, 20), 10);
    expect(up.scrollTop).toBe(0); // never negative
  });

  it("never scrolls past the end of the list", () => {
    const menu = box(0, 100, 260);
    scrollMentionItemIntoView(menu, row(1000, 20));
    expect(menu.scrollTop).toBe(160); // scrollHeight - clientHeight
  });
});
