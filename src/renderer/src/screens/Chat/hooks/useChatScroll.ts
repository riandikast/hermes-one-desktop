import { useCallback, useEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import type { ChatMessage } from "../types";
import { createAtom, useAtomValue } from "./useChatScrollAtoms";
import { resolveOfficialScrollTarget } from "./useOfficialChatScroll";

/**
 * Chat scroll — official single-owner adapter (phase 2).
 *
 * Delegates to `use-stick-to-bottom` (the official desktop's scroll owner)
 * while preserving the fork's public contract:
 *   { containerRef, contentRef, bottomRef, jumpToPresent, scrolledUpAtom }
 *
 * `containerRef` = scroll container (official `scrollRef`)
 * `contentRef`   = inner content wrapper (official `contentRef`) — Chat.tsx
 *                  must wrap scrollable children with it.
 * `bottomRef`    = kept for API compatibility (legacy sentinel); still
 *                  rendered but no longer drives the pinned state.
 * `scrolledUpAtom` mirrors `!isAtBottom` for JumpToLatest / composer.
 * `jumpToPresent` clears pinned state and snaps to bottom via the official
 * hook (with subpixel epsilon handling).
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  jumpToPresent: (force?: boolean) => () => void;
  scrolledUpAtom: ReturnType<typeof createAtom<boolean>>;
  /**
   * Break the stick-to-bottom lock WITHOUT scrolling. This is the correct way
   * for a programmatic scroll elsewhere in the chat (in-chat search jumping to
   * a match) to stop the auto-follow: `scrolledUpAtom.set(true)` alone is
   * overwritten by the `isAtBottom` sync effect, but `stopScroll()` escapes the
   * library's scroll lock so `isAtBottom` itself flips false and the atom
   * follows. Restick by scrolling back to the bottom (or jumpToPresent).
   */
  stopFollow: () => void;
} {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
      targetScrollTop: resolveOfficialScrollTarget,
    });

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrolledUpAtom = useRefReturn(createAtom<boolean>(!isAtBottom));
  const prevCountRef = useRef(messages.length);

  // Keep atom in sync with official isAtBottom (single source of truth).
  useEffect(() => {
    scrolledUpAtom.current.set(!isAtBottom);
  }, [isAtBottom]);

  // Track count for potential future session-switch heuristics; official
  // hook already auto-follows while pinned, so no manual snap needed here.
  useEffect(() => {
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const jumpToPresent = useCallback(
    (force = false): (() => void) => {
      void force;
      scrolledUpAtom.current.set(false);
      void scrollToBottom("instant");
      return () => {};
    },
    [scrollToBottom],
  );

  // Keep atom subscription alive for HMR / debug.
  void useAtomValue(scrolledUpAtom.current);

  return {
    containerRef: scrollRef as React.RefObject<HTMLDivElement | null>,
    contentRef: contentRef as React.RefObject<HTMLDivElement | null>,
    bottomRef,
    jumpToPresent,
    scrolledUpAtom: scrolledUpAtom.current,
    stopFollow: stopScroll,
  };
}

function useRefReturn<T>(value: T): { current: T } {
  const ref = useRef(value);
  return ref;
}
