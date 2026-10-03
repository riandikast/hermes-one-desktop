// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shouldLoadNextPage } from "./SidebarRecentSessions";

/**
 * The infinite-scroll loader appends rows when the list nears the bottom.
 * Appending grows scrollHeight while scrollTop stays put, so the naive
 * "remaining <= threshold" test re-fires from the SAME position and chains
 * pages — one flick dumped several pages ("scroll down is too much"). These
 * tests pin the gate that stops the cascade.
 */

const CLIENT = 600;
const THRESHOLD = 180;

describe("shouldLoadNextPage", () => {
  it("does not load while far from the bottom", () => {
    // scrollTop 0, content 3000 -> remaining 2400, well over threshold.
    expect(shouldLoadNextPage(0, 3000, CLIENT, null)).toBe(false);
  });

  it("loads when near the bottom and no page has landed yet", () => {
    // remaining = 3000 - 2500 - 600 = -100 <= 180.
    expect(shouldLoadNextPage(2500, 3000, CLIENT, null)).toBe(true);
  });

  it("treats exactly-threshold distance as loadable", () => {
    // remaining = 3000 - 2220 - 600 = 180 (== threshold).
    expect(shouldLoadNextPage(2220, 3000, CLIENT, THRESHOLD)).toBe(true);
  });

  it("suppresses a repeat load from the same scroll position (the bug)", () => {
    // A page just landed at scrollTop 2500; content grew but the user has not
    // scrolled further, so the threshold must NOT fire again.
    expect(shouldLoadNextPage(2500, 6000, CLIENT, 2500)).toBe(false);
    // Even a small settle-back (elastic overscroll reports a smaller top) stays
    // suppressed — otherwise the bounce itself would trigger a page.
    expect(shouldLoadNextPage(2480, 6000, CLIENT, 2500)).toBe(false);
  });

  it("loads again once the user scrolls past the recorded position", () => {
    // The user scrolled forward AND is now near the bottom of the grown content:
    // scrollTop 5500, scrollHeight 6000, client 600 -> remaining -100 <= 180,
    // and 5500 > loadedAt(2500), so the gate opens.
    expect(shouldLoadNextPage(5500, 6000, CLIENT, 2500)).toBe(true);
  });

  it("stays suppressed when scrolled past the mark but still far from the bottom", () => {
    // Scrolling slightly forward is not enough on its own; the threshold must
    // also be met. remaining = 6000 - 2600 - 600 = 2800 > 180.
    expect(shouldLoadNextPage(2600, 6000, CLIENT, 2500)).toBe(false);
  });

  it("auto-fills a list too short to overflow", () => {
    // No overflow: scrollHeight <= clientHeight, loadedAt may be set from an
    // earlier fill — the list must keep paging until it fills the sidebar.
    expect(shouldLoadNextPage(0, 500, CLIENT, 0)).toBe(true);
    expect(shouldLoadNextPage(0, 500, CLIENT, null)).toBe(true);
  });

  it("does not stick permanently when parked at the very end", () => {
    // Maxed-out list: loadedAt equals maxScroll. The gate is one-shot, so a
    // subsequent load is still allowed rather than blocking forever.
    const maxScroll = 6000 - CLIENT;
    expect(shouldLoadNextPage(maxScroll, 6000, CLIENT, maxScroll)).toBe(true);
  });

  it("still gates when loadedAt is above the bottom", () => {
    const maxScroll = 6000 - CLIENT;
    // loadedAt (2500) < maxScroll (5400) -> the gate is active and suppresses.
    expect(shouldLoadNextPage(2500, 6000, CLIENT, 2500)).toBe(false);
    expect(maxScroll).toBeGreaterThan(2500);
  });
});
