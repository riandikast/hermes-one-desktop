import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import { createAtom, useAtomValue } from "./useChatScrollAtoms";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when the user sends a new message.
 * - `jumpToPresent` forces an instant snap to the bottom — used on first mount,
 *   when the user sends a message, and when the tab becomes active again.
 * - Exposes the container ref and a bottom sentinel ref to be placed in JSX.
 *
 * Atom mirrors (`scrolledUp` / `userScrolledUpRef`): the jump-to-latest button
 * (lives in a sibling subtree) and the composer (separate component) read
 * pinned state. The ref is the synchronous source of truth inside the hook;
 * the atom is the bridge for outside consumers. Both stay in lock-step via
 * the shared setScrolledUp() helper.
 *
 * Bug fix (Aug 2026): the previous `messages`-effect snap fired on EVERY
 * messages change, including passive recomputes from reconcileAfterDbRefresh
 * and DB refreshes that touched `messages` without changing scrollHeight.
 * With no active turn, that re-armed the snap path, fought the user's scroll,
 * and "yanked" the viewport on every quiet state update. The fix: ONLY snap
 * when scrollHeight actually grew (or shrunk) above the prior reading, AND
 * the user is still pinned. Doc-level diffs (no height change) are silent.
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  jumpToPresent: (force?: boolean) => () => void;
  scrolledUpAtom: ReturnType<typeof createAtom<boolean>>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  /** Atom mirror — consumers (jump button, composer) read this. */
  const scrolledUpAtom = useRefReturn(createAtom<boolean>(false));
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
  /** Last observed scrollHeight — the gate for "should I snap on this update". */
  const lastScrollHeightRef = useRef(0);

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
    // Over-scroll to clamp: the browser clamps scrollTop to
    // `scrollHeight - clientHeight`. Reading that value directly can land
    // SHORT when the virtual window still holds ESTIMATED heights for
    // unmounted rows below the viewport (scrollHeight grows once those rows
    // mount and are measured). The huge-value clamp always resolves to the
    // current true bottom.
    container.scrollTop = Number.MAX_SAFE_INTEGER;
    const max = container.scrollHeight - container.clientHeight;
    maxScrollTopRef.current = max;
    lastScrollHeightRef.current = container.scrollHeight;
  }, []);

  // Keep the cached max scroll position fresh when the container resizes
  // (layout is clean at ResizeObserver callback time, so the read is cheap).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const h = container.scrollHeight;
      maxScrollTopRef.current = h - container.clientHeight;
      lastScrollHeightRef.current = h;
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
  const jumpToPresent = useCallback(
    (force = false): (() => void) => {
      setScrolledUp(false);
      // Reset the height gate so the next per-delta snap fires even if the
      // current scrollHeight matches our last reading (rare — but possible
      // after a programmatic scroll that we want to "stick" at bottom).
      lastScrollHeightRef.current = 0;
      snapToBottom();
      // The settle retries catch late layout (rows mounting, images/fonts
      // landing) at the BOTTOM. On a normal jump they must NOT fight a user
      // who scrolls up right after sending — gate each retry on the pinned
      // flag so an upward scroll cancels the settle. But a FORCED jump (tab
      // activation, "jump to latest" button) is an explicit "show me the
      // present" — a transient stale-max read during a processing stream can
      // otherwise flip the pinned flag and abort the settle, leaving the tab
      // short of the bottom. Force un-gates the retries so the jump always
      // completes.
      const settleSnap = (): void => {
        if (force || !userScrolledUpRef.current) snapToBottom();
      };
      if (force) {
        // Tab activation / "jump to latest" is an explicit "show the
        // present": ONE instant snap + a single rAF correction (catches
        // the display:none→flex relayout). The timeout barrage is what read
        // as "blink" — repeated re-snaps mid-stream. A processing turn keeps
        // following via the per-delta streaming snap, so no settle retries
        // are needed here. Mirrors the official desktop's use-stick-to-bottom
        // (scrollToBottom = one instant snap; resize observer follows).
        const raf = requestAnimationFrame(settleSnap);
        return (): void => {
          cancelAnimationFrame(raf);
        };
      }
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
    },
    [snapToBottom, setScrolledUp],
  );

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
      setScrolledUp(!atBottom);
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [setScrolledUp]);

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
        setScrolledUp(true);
      }
    }
    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [setScrolledUp]);

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
  // ONLY while the user is pinned to the bottom.
  //
  // HEIGHT-GATED (bug fix): the previous version snapped on every `messages`
  // change. `messages` re-renders frequently from reconcileAfterDbRefresh,
  // DB refreshes, fileChanges badges, etc. — most of which don't change
  // scrollHeight at all. With no active turn, those re-armed the snap path
  // and yanked the viewport. Now we read the container's scrollHeight in
  // the macrotask and only snap if it actually grew past the prior reading.
  // A passive reconcile (no height change) is silent. The collapse-into-one
  // pending-snap flag still de-dupes per-frame stream deltas.
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
      // HEIGHT GATE: read scrollHeight NOW (safe — the macrotask runs after
      // the browser has painted the new commit) and skip if nothing grew.
      // This is the kill-switch for the "fighting even with no process" bug:
      // passive reconciles and DB refreshes that touch `messages` but don't
      // add visible height are silent.
      const container = containerRef.current;
      if (!container) return;
      const currentHeight = container.scrollHeight;
      if (currentHeight <= lastScrollHeightRef.current) return;
      lastScrollHeightRef.current = currentHeight;
      snapToBottom();
    }, 0);
    return undefined;
  }, [messages, jumpToPresent, snapToBottom]);

  // Jump-to-latest atom consumers — read once here so the atom is referenced
  // (keeps the module's hook subscription alive during HMR), and so we can
  // log if the bridge ever drifts out of sync.
  void useAtomValue(scrolledUpAtom.current);

  return {
    containerRef,
    bottomRef,
    jumpToPresent,
    scrolledUpAtom: scrolledUpAtom.current,
  };
}

/**
 * `useRef(createAtom(...))` — a stable atom per hook instance. `useRef` is
 * the right primitive here (createAtom returns an object, not a value).
 */
function useRefReturn<T>(value: T): { current: T } {
  const ref = useRef(value);
  return ref;
}
