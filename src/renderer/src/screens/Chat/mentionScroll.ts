/**
 * Keep the keyboard-highlighted @-mention row inside the picker's own scroll box.
 *
 * The mention menu is a fixed-height scroll container (`max-height: 260px`), and
 * arrow navigation only moved the highlight — past the fold the selected row
 * walked off-screen and there was no way to see (or trust) what Enter would
 * insert. Doing the math here instead of `scrollIntoView()` keeps the chat
 * transcript and the composer from scrolling too.
 */
export interface ScrollableRect {
  top: number;
  bottom: number;
}

export interface Scrollable {
  scrollTop: number;
}

export interface Measurable {
  getBoundingClientRect(): ScrollableRect;
}

/**
 * Scroll `container` by the minimum amount that reveals `item`, keeping
 * `padding` px of breathing room at both edges. A no-op when already visible.
 */
export function scrollMentionItemIntoView(
  container: Scrollable & Measurable,
  item: Measurable,
  padding = 6,
): void {
  const box = container.getBoundingClientRect();
  const row = item.getBoundingClientRect();
  const top = box.top + padding;
  const bottom = box.bottom - padding;
  if (row.top < top) container.scrollTop -= top - row.top;
  else if (row.bottom > bottom) container.scrollTop += row.bottom - bottom;
}
