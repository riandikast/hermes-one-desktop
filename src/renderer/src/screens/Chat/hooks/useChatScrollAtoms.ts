import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny atom — no external dep. Lets components outside the scroll hook read
 * scroll state without prop drilling, and lets the scroll hook broadcast its
 * own state for things like the jump-to-latest button gating.
 *
 * WHY this exists: scroll state is read from THREE places — the hook's own
 * gating logic, the jump-to-latest button (visible only when scrolled up),
 * and the composer/status stack (dim when scrolled up). A ref-only pattern
 * works for one consumer; the button is in a sibling subtree and the composer
 * is a separate component. An atom is the right fit — no extra dep, mirrors
 * the official desktop's `useStore($threadJumpButtonVisible)` pattern
 * (apps/desktop/src/store/thread-scroll.ts: `$threadScrolledUp` /
 * `$threadJumpButtonVisible`).
 *
 * Skip-no-op setter: every scroll event fires set; without the Object.is
 * guard, every subscriber re-renders on every pixel of scroll. The guard
 * keeps consumers like the jump button cheap.
 */
export function createAtom<T>(initial: T): {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
} {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe to an atom and re-render on change. */
export function useAtomValue<T>(atom: {
  get: () => T;
  subscribe: (l: () => void) => () => void;
}): T {
  const subscribe = useCallback(
    (l: () => void) => atom.subscribe(l),
    [atom],
  );
  const getSnapshot = useCallback(() => atom.get(), [atom]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
