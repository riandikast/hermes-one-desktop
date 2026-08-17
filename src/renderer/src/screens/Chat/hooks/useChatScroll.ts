import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import { createAtom, useAtomValue } from "./useChatScrollAtoms";

/**
 * Auto-scroll behavior for the chat messages container — official-style
 * single-owner model.
 *
 * One `isAtBottom` authority (rAF-throttled scroll listener + sentinel IO)
 * and one `snap` path. No competing wheel flag / programmatic guard / max
 * cache / timeout barrage — those were the blink + fight source.
 *
 * - `userScrolledUpRef` is the synchronous source of truth; `scrolledUpAtom`
 *   is the bridge for sibling consumers (JumpToLatest, composer). Both stay
 *   in lock-step via `setScrolledUp`.
 * - Streaming deltas auto-stick ONLY while pinned. Coalesced to one rAF per
 *   frame so a burst of deltas doesn't flood.
 * - `jumpToPresent(true)` is an explicit "show the present" (mount, tab
 *   activation, Jump button). It clears the pinned flag and does a
 *   synchronous snap + double-rAF settle to let the virtualizer's
 *   `content-visibility: auto` rows re-measure after `display:none→flex`.
 * - ResizeObserver on the container is intentionally NOT the content-growth
 *   driver — the container's content-box doesn't change when scrollHeight
 *   grows (overflow). Content growth is driven by the `messages` effect.
 */
const AT_BOTTOM_TOLERANCE_PX = 60;

export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  jumpToPresent: (force?: boolean) => () => void;
  scrolledUpAtom: ReturnType<typeof createAtom<boolean>>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const scrolledUpAtom = useRefReturn(createAtom<boolean>(false));
  const prevMessageCountRef = useRef(messages.length);
  const mountedRef = useRef(false);
  const pendingSnapRef = useRef(false);

  const setScrolledUp = useCallback(
    (next: boolean): void => {
      if (userScrolledUpRef.current === next) return;
      userScrolledUpRef.current = next;
      scrolledUpAtom.current.set(next);
    },
    [scrolledUpAtom],
  );

  const snapToBottom = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    // Over-scroll clamp: resolves to `scrollHeight - clientHeight` even when
    // the virtual window still holds estimated heights for unmounted rows.
    container.scrollTop = Number.MAX_SAFE_INTEGER;
  }, []);

  // Explicit "show the present" — mount, tab activation, Jump button.
  const jumpToPresent = useCallback(
    (force = false): (() => void) => {
      void force;
      setScrolledUp(false);
      snapToBottom();
      // Double-rAF settle: first lets the browser lay out the pane after
      // display:none→flex / virtual rows re-measure; second catches the true
      // bottom once `content-visibility:auto` rows replace their 120px
      // intrinsic estimate. No setTimeout barrage — it re-snapped mid-stream.
      const raf1 = requestAnimationFrame(() => {
        snapToBottom();
        requestAnimationFrame(snapToBottom);
      });
      return (): void => {
        cancelAnimationFrame(raf1);
      };
    },
    [snapToBottom, setScrolledUp],
  );

  // First mount — show the present instantly.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const cleanup = jumpToPresent();
    return cleanup;
  }, [jumpToPresent]);

  // Single-owner scroll listener: rAF-throttled atBottom check. This is the
  // SOLE writer of the pinned flag during manual scroll (no wheel listener).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let ticking = 0;
    const handleScroll = (): void => {
      if (ticking) return;
      ticking = requestAnimationFrame(() => {
        ticking = 0;
        const el = container;
        const atBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight <
          AT_BOTTOM_TOLERANCE_PX;
        setScrolledUp(!atBottom);
      });
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (ticking) cancelAnimationFrame(ticking);
    };
  }, [setScrolledUp]);

  // Sentinel IntersectionObserver — supplements the scroll listener for
  // programmatic / layout-driven position changes that don't fire scroll
  // (mount, virtualizer window slide, display:none→flex). The scroll
  // listener remains authoritative during drag; the IO just re-syncs the
  // flag when the sentinel's visibility changes without a scroll event.
  useEffect(() => {
    const container = containerRef.current;
    const bottom = bottomRef.current;
    if (
      !container ||
      !bottom ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Use IO's isIntersecting as the atBottom signal (rootMargin gives
        // the same 60px tolerance as the scroll check).
        const atBottom = entry.isIntersecting;
        // Defer to next frame so a programmatic snap's scroll event settles
        // first — otherwise the IO callback can race the scroll handler.
        requestAnimationFrame(() => setScrolledUp(!atBottom));
      },
      { root: container, threshold: 0, rootMargin: `${AT_BOTTOM_TOLERANCE_PX}px 0px 0px 0px` },
    );
    io.observe(bottom);
    return () => io.disconnect();
  }, [setScrolledUp]);

  // Re-jump when the window becomes visible again while pinned (minimized /
  // alt-tab during a stream left the settle rAFs frozen and scroll stale).
  useEffect(() => {
    const onVisible = (): void => {
      if (
        document.visibilityState === "visible" &&
        !userScrolledUpRef.current
      ) {
        jumpToPresent();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [jumpToPresent]);

  // Auto-stick on incoming messages. User send always forces to present;
  // streaming deltas stick only while pinned. One rAF per frame coalesces
  // a burst of deltas (the typewriter can emit many per frame).
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    const userJustSent =
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user";
    if (userJustSent) {
      return jumpToPresent();
    }
    if (userScrolledUpRef.current) return;
    if (pendingSnapRef.current) return;
    pendingSnapRef.current = true;
    const raf = requestAnimationFrame(() => {
      pendingSnapRef.current = false;
      if (userScrolledUpRef.current) return;
      snapToBottom();
    });
    return (): void => cancelAnimationFrame(raf);
  }, [messages, jumpToPresent, snapToBottom]);

  // Keep the atom subscription alive for HMR and for debug drift checks.
  void useAtomValue(scrolledUpAtom.current);

  return {
    containerRef,
    bottomRef,
    jumpToPresent,
    scrolledUpAtom: scrolledUpAtom.current,
  };
}

function useRefReturn<T>(value: T): { current: T } {
  const ref = useRef(value);
  return ref;
}
