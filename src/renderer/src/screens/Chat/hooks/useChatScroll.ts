import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when a new user message is sent.
 * - `jumpToPresent` forces an instant snap to the bottom — used on first mount,
 *   when the user sends a message, and when the tab becomes active again.
 * - Exposes the container ref and a bottom sentinel ref to be placed in JSX.
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  jumpToPresent: (force?: boolean) => () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const mountedRef = useRef(false);
  /** One pending streaming snap (macrotask) at a time. */
  const pendingSnapRef = useRef(false);
  /**
   * Cached `scrollHeight - clientHeight` so the scroll listener can decide
   * pinned-vs-scrolled-up WITHOUT reading `scrollHeight` — that read forces a
   * synchronous layout, and during streaming the layout is dirty every frame
   * (typewriter growth), making wheel scrolling janky. Refreshed by every
   * snap and by a ResizeObserver (whose callback runs after layout, so the
   * read there is cheap).
   */
  const maxScrollTopRef = useRef(0);

  const snapToBottom = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    // Over-scroll to clamp: the browser clamps scrollTop to
    // `scrollHeight - clientHeight`. Reading that value directly can land
    // SHORT when the virtual window still holds ESTIMATED heights for
    // unmounted rows below the viewport (scrollHeight grows once those rows
    // mount and are measured). The huge-value clamp always resolves to the
    // current true bottom, and the settle retries ride out the corrections.
    container.scrollTop = Number.MAX_SAFE_INTEGER;
    const max = container.scrollHeight - container.clientHeight;
    maxScrollTopRef.current = max;
  }, []);

  // Keep the cached max scroll position fresh when the container resizes
  // (layout is clean at ResizeObserver callback time, so the read is cheap).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      maxScrollTopRef.current = container.scrollHeight - container.clientHeight;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Force an instant bottom snap regardless of the user's scroll state, plus a
  // few settle retries. Rows use `content-visibility: auto`, so their real
  // height replaces the 120px intrinsic estimate only once they scroll into
  // view (and images / fonts arrive late) — a single synchronous snap can land
  // short of the true bottom once that late layout lands, so re-snap on the
  // next frames + a couple of short timeouts to actually reach the present.
  // Returns a cleanup that cancels the pending retrials.
  const jumpToPresent = useCallback((force = false): (() => void) => {
    userScrolledUpRef.current = false;
    snapToBottom();
    // The settle retries catch late layout (rows mounting, images/fonts
    // landing) at the BOTTOM. On a normal jump they must NOT fight a user who
    // scrolls up right after sending — gate each retry on the pinned flag so
    // an upward scroll cancels the settle. But a FORCED jump (tab activation,
    // "jump to latest" button) is an explicit "show me the present" — a
    // transient stale-max read during a processing stream can otherwise flip
    // the pinned flag and abort the settle, leaving the tab short of the
    // bottom. Force un-gates the retries so the jump always completes.
    const settleSnap = (): void => {
      if (force || !userScrolledUpRef.current) snapToBottom();
    };
    const raf = requestAnimationFrame(settleSnap);
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(settleSnap),
    );
    const t1 = window.setTimeout(settleSnap, 80);
    const t2 = window.setTimeout(settleSnap, 250);
    // Late measurement corrections (a long session's bottom rows mounting
    // after the window slides, or images/fonts landing) can move the true
    // bottom after the earlier retries — one more pass catches the tail.
    const t3 = window.setTimeout(settleSnap, 500);
    return (): void => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [snapToBottom]);

  // On first mount (opening/resuming a session) jump INSTANTLY to the bottom.
  // Smooth scrollIntoView from an unlaid-out container (content-visibility
  // rows, still-loading images) lands at the top of a long conversation.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    const cleanup = jumpToPresent();
    return cleanup;
  }, [jumpToPresent]);

  // Track manual scroll position. Programmatic snaps also fire `scroll`, which
  // is harmless (they report atBottom → stays pinned). A wheel / touch scroll
  // up past the threshold flips the ref and pauses auto-scroll until the user
  // sends a message or switches tabs back (jumpToPresent resets it).
  // Layout-free: uses the CACHED max scroll position (refreshed by snaps and
  // the ResizeObserver) instead of reading `scrollHeight` per scroll event —
  // that read forces a synchronous layout while the stream is dirtying layout
  // every frame, which made wheel scrolling janky mid-stream.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let maxRefreshRaf = 0;
    function handleScroll(): void {
      const el = container!;
      // Keep the cached max fresh WITHOUT a per-event layout read: when the
      // user is near the cached bottom, schedule ONE rAF-throttled
      // scrollHeight read. A stale max (content grew via reveal batches or
      // a streaming turn; only snaps used to refresh it) flipped the
      // atBottom check to "pinned" while the user was scrolled up,
      // re-arming the snap machinery — the continuous scroll.
      if (
        el.scrollTop >= maxScrollTopRef.current - 120 &&
        maxRefreshRaf === 0
      ) {
        maxRefreshRaf = requestAnimationFrame(() => {
          maxRefreshRaf = 0;
          const realMax = el.scrollHeight - el.clientHeight;
          if (realMax > maxScrollTopRef.current) {
            maxScrollTopRef.current = realMax;
          }
        });
      }
      const atBottom = el.scrollTop >= maxScrollTopRef.current - 60;
      userScrolledUpRef.current = !atBottom;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Immediately pause auto-scroll on any upward scroll intent. The 60px
  // position threshold alone cannot stop the mid-stream snap flood: each delta
  // schedules a bottom snap, and a slow wheel scroll stays inside the 60px
  // window long enough that the snap re-pins the viewport before the flag ever
  // flips — the user can never scroll up while the model streams. Wheel fires
  // for both mouse wheel and trackpad two-finger scroll in Chromium, so one
  // listener covers both. Re-pinning still flows through the position check in
  // handleScroll (scroll back to the bottom to resume following).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleWheel(e: WheelEvent): void {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true;
      }
    }
    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // When the window becomes visible again (minimize/restore, alt-tab back),
  // re-jump to the present IF the user was pinned to the bottom. While
  // minimized Chromium freezes rAF and throttles timers, so the auto-scroll
  // settle retries never ran and the scroll position went stale — the answer
  // that streamed while hidden sits at the bottom, skipped by
  // `content-visibility: auto` (looks like "the last answer never appeared
  // until the session was reopened"). A pinned user expects to land on the
  // latest; a user who scrolled up keeps their place.
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

  // Auto-scroll on incoming messages; force-scroll when the user sends a new
  // one. Streaming deltas (same length, content grew) keep the latest in view
  // ONLY while the user is pinned to the bottom. The snap itself runs in a
  // MACROTASK (setTimeout 0), not synchronously in the React commit: reading
  // `scrollHeight` forces a synchronous layout, and doing that per delta
  // inside the commit janked streaming (laggy thinking/tool animation). By
  // the time the macrotask runs, the browser has already painted the grown
  // row, so the layout is clean and the snap costs only a scroll-position
  // change. A pending flag collapses deltas that land in the same frame into
  // one snap, and the ref is re-checked so a wheel scroll between the delta
  // and the task is never overridden. rAF was NOT used: forcing layout inside
  // the frame callback double-layouts every frame (constant jank).
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
    // Collapse deltas landing in the same frame into ONE snap: the first
    // delta schedules the task, the rest see the pending flag and skip. The
    // task resets the flag itself; an unmounted container is a guarded no-op.
    if (pendingSnapRef.current) return;
    pendingSnapRef.current = true;
    window.setTimeout(() => {
      pendingSnapRef.current = false;
      // The user may have scrolled up since this snap was scheduled.
      if (userScrolledUpRef.current) return;
      snapToBottom();
    }, 0);
    return undefined;
  }, [messages, jumpToPresent, snapToBottom]);

  // Single, retry-free bottom snap for the reveal batches. jumpToPresent's
  // rAF/timeout retry barrage re-snaps over ~250ms while the batch layout
  // settles, which VISIBLY re-jumps the viewport (blink). The reveal needs
  // The reveal batches compensate the viewport via the owner's manual
  // anchoring (offsetTop delta), so no per-batch snap exists here.
  return { containerRef, bottomRef, jumpToPresent };
}