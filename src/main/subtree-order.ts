/**
 * Pre-order DFS of the subtree rooted at `rootId` (root first, then each
 * child's own subtree). Reversing the result yields a post-order — children
 * before parents — the order required to delete a subtree without tripping
 * the sessions.parent_session_id foreign key.
 */
export function collectSubtreeOrder(
  rootId: string,
  childrenOf: (id: string) => string[],
): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const children = childrenOf(id);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  // Reversed pre-order ≈ post-order (children before parents). Real session
  // trees have exactly one parent per child, so this is already correct —
  // but a corrupt diamond (child linked from two parents) can put a child
  // AFTER one of its parents, which would trip the FK on delete. Fix-up pass:
  // move each child ahead of every parent that currently precedes it.
  order.reverse();
  for (let i = 0; i < order.length; i++) {
    for (const child of childrenOf(order[i])) {
      const childIdx = order.indexOf(child, i + 1);
      if (childIdx === -1) continue; // already before the parent
      order.splice(childIdx, 1);
      order.splice(i, 0, child);
      // Re-check the moved child's own children (its position changed).
      i--;
      break;
    }
  }
  return order;
}
