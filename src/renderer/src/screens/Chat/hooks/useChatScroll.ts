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
  jumpToPresent: () => () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const mountedRef = useRef(false);
  /** One pending streaming snap (macrotask) at a time. */
  const pendingSnapRef = useRef(false);

  const snapToBottom = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  // Force an instant bottom snap regardless of the user's scroll state, plus a
  // few settle retries. Rows use `content-visibility: auto`, so their real
  // height replaces the 120px intrinsic estimate only once they scroll into
  // view (and images / fonts arrive late) — a single synchronous snap can land
  // short of the true bottom once that late layout lands, so re-snap on the
  // next frames + a couple of short timeouts to actually reach the present.
  // Returns a cleanup that cancels the pending retrials.
  const jumpToPresent = useCallback((): (() => void) => {
    userScrolledUpRef.current = false;
    snapToBottom();
    const raf = requestAnimationFrame(snapToBottom);
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(snapToBottom),
    );
    const t1 = window.setTimeout(snapToBottom, 80);
    const t2 = window.setTimeout(snapToBottom, 250);
    return (): void => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
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
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
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
  }, [messages, jumpToPresent, snapToBottom]);

  return { containerRef, bottomRef, jumpToPresent };
}
