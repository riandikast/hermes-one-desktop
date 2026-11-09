/**
 * Keep the keyboard-highlighted @-mention row inside the picker's own scroll box.
 *
 * The mention menu is a fixed-height scroll container (`max-height: 260px`), and
 * arrow navigation only moved the highlight — past the fold the selected row
 * walked off-screen and there was no way to see (or trust) what Enter would
 * insert.
 *
 * The math uses layout offsets (untransformed CSS pixels) rather than viewport
 * rects: an ancestor with a transform, zoom or entrance animation rescales
 * `getBoundingClientRect()`, which made the old rect-based delta land short and
 * left the row below the fold.
 */
export interface MentionScrollBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface MentionScrollItem {
  offsetTop: number;
  offsetHeight: number;
}

/** Where `item` sits in `box`'s scroll content, even when the offsetParent differs. */
export function mentionItemOffset(
  box: HTMLElement,
  item: HTMLElement,
): MentionScrollItem {
  if (item.offsetParent === box) {
    return { offsetTop: item.offsetTop, offsetHeight: item.offsetHeight };
  }
  const boxRect = box.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  return {
    offsetTop: itemRect.top - boxRect.top + box.scrollTop,
    offsetHeight: item.offsetHeight || itemRect.height,
  };
}

/**
 * Scroll `box` by the minimum amount that reveals `item`, keeping `padding` px
 * of breathing room at both edges and never scrolling past either end. A no-op
 * when the row is already visible.
 */
export function scrollMentionItemIntoView(
  box: MentionScrollBox,
  item: MentionScrollItem,
  padding = 6,
): void {
  const viewTop = box.scrollTop;
  const viewBottom = viewTop + box.clientHeight;
  const itemTop = item.offsetTop - padding;
  const itemBottom = item.offsetTop + item.offsetHeight + padding;

  let next = viewTop;
  if (itemTop < viewTop) next = itemTop;
  else if (itemBottom > viewBottom) next = itemBottom - box.clientHeight;

  if (next === viewTop) return;
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  box.scrollTop = Math.max(0, Math.min(next, max));
}
