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
  // ONLY while the user is pinned to the bottom — a single instant
  // `scrollTop = scrollHeight` per delta. We deliberately do NOT retry here:
  // rows carry `content-visibility: auto` + the `messageIn` entrance
  // animation, and repeated scroll writes per delta jolt rows across the
  // viewport skip boundary, restarting that animation (a visible fade-in
  // flicker on the thought row). One snap reaches the present exactly (the
  // prior smooth `scrollIntoView` landed short); late layout is only a
  // concern for the one-time mount/tab-switch jump, which uses `jumpToPresent`'
  // retries. `jumpToPresent` returns its own cleanup, so returning it lets the
  // next delta cancel any pending retrials from a user-sent force-jump.
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
    // One synchronous snap per delta. (An earlier rAF-batched version forced
    // layout inside the frame callback — double layout passes per frame,
    // making streaming jank constant instead of occasional.)
    snapToBottom();
  }, [messages, jumpToPresent, snapToBottom]);

  return { containerRef, bottomRef, jumpToPresent };
}
