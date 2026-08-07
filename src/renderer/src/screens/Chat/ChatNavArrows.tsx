import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, ArrowDown } from "lucide-react";
import type { ChatMessage } from "./types";

const rowId = (id: string): string => `chat-msg-${id}`;

const AT_BOTTOM_TOLERANCE_PX = 60;

interface ChatNavArrowProps {
  position: "top" | "bottom";
  messages: ChatMessage[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Floating arrow pinned to the top/bottom middle of the chat messages
 * scrollport for fast stepping between USER messages (questions) in a long
 * conversation.
 *
 * - Top arrow: visible while scrolled UP (not at the bottom); click scrolls to
 *   the previous user message above the viewport centre.
 * - Bottom arrow: visible while at the bottom; click scrolls to the next user
 *   message below the viewport centre — or, when the last question is already
 *   above the centre (the usual state at the bottom of a long answer), to the
 *   LATEST user message, so the arrow is never a dead button.
 *
 * Pinning is `position: sticky` on a zero-height wrapper (first/last child of
 * the scroll container), so the button hovers over the messages and never
 * scrolls with the content; the scroll listener only toggles visibility.
 * Visibility requires the transcript to be actually scrollable (a short chat
 * has nothing to navigate), so the arrows never show in trivial conversations.
 */
export const ChatNavArrow = memo(function ChatNavArrow({
  position,
  messages,
  containerRef,
}: ChatNavArrowProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  // Read latest messages from a ref so the scroll listener attaches once
  // instead of re-binding on every streamed delta.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const update = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      AT_BOTTOM_TOLERANCE_PX;
    const scrollable =
      container.scrollHeight - container.clientHeight > AT_BOTTOM_TOLERANCE_PX;
    let anyAbove = false;
    let anyBelow = false;
    for (const msg of messagesRef.current) {
      if (msg.role !== "user") continue;
      const el = document.getElementById(rowId(msg.id));
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < center) anyAbove = true;
      else if (r.top > center) anyBelow = true;
    }
    if (!scrollable) {
      setVisible(false);
      return;
    }
    // Top arrow: scrolled up AND a previous question sits above the centre.
    // Bottom arrow: a next question sits below the centre — NOT gated on the
    // absolute bottom, so it appears as soon as you scroll down toward the
    // next question instead of only at max scroll (where you're already at
    // the latest and the arrow would be pointless).
    if (position === "top") setVisible(!atBottom && anyAbove);
    else setVisible(anyBelow);
  }, [containerRef, position]);

  useEffect(() => {
    update();
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // The mount-time reading may be taken before layout settles (zero-height
    // container) — re-evaluate a couple of frames later and whenever the
    // container resizes, so a SHORT chat (nothing scrollable) never keeps a
    // stale "visible" state from a wrong first measurement.
    const raf = requestAnimationFrame(() => requestAnimationFrame(update));
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(container);
    }
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [containerRef, update]);

  // Re-evaluate when messages change (a short chat crossing into scrollable
  // territory — or shrinking — needs a visibility update without a scroll).
  useEffect(() => {
    const raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [messages, update]);

  const jump = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const center =
      container.getBoundingClientRect().top +
      container.getBoundingClientRect().height / 2;
    let target: string | null = null;
    let lastUser: string | null = null;
    for (const msg of messagesRef.current) {
      if (msg.role !== "user") continue;
      lastUser = msg.id;
      const el = document.getElementById(rowId(msg.id));
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (position === "top" && r.bottom < center) {
        target = msg.id; // keep walking: ends at the last one above centre
      } else if (position === "bottom" && r.top > center) {
        target = msg.id; // first one below centre
        break;
      }
    }
    // Bottom arrow at the very bottom: the next question below the centre is
    // usually already gone, so fall back to the LATEST user message — the
    // arrow stays useful ("back to my latest question") instead of dead.
    if (position === "bottom" && !target) target = lastUser;
    const el = target ? document.getElementById(rowId(target)) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [containerRef, position]);

  if (!messages.some((m) => m.role === "user")) return null;

  const Icon = position === "top" ? ChevronUp : ChevronDown;
  return (
    <div
      className={`chat-nav-arrow-wrap chat-nav-arrow-wrap--${position}`}
      aria-hidden={!visible}
    >
      <button
        type="button"
        className={`chat-nav-arrow${visible ? " chat-nav-arrow--visible" : ""}`}
        onClick={jump}
        tabIndex={visible ? 0 : -1}
        aria-label={
          position === "top" ? "Go to previous question" : "Go to next question"
        }
        title={position === "top" ? "Previous question" : "Next question"}
      >
        <Icon size={18} />
      </button>
    </div>
  );
});

/**
 * "Jump to present" button pinned to the bottom-RIGHT of the chat messages
 * scrollport (ChatGPT-style back-to-latest). Visible only while scrolled up;
 * clicking smooth-scrolls to the newest message and re-engages auto-scroll
 * (the scroll listener in useChatScroll clears `userScrolledUp` once at the
 * bottom).
 */
export const JumpToLatest = memo(function JumpToLatest({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);

  const update = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      AT_BOTTOM_TOLERANCE_PX;
    const scrollable =
      container.scrollHeight - container.clientHeight > AT_BOTTOM_TOLERANCE_PX;
    setVisible(scrollable && !atBottom);
  }, [containerRef]);

  useEffect(() => {
    update();
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Same stale-first-measurement guard as ChatNavArrow: a short chat must
    // not keep the button from a wrong mount-time reading.
    const raf = requestAnimationFrame(() => requestAnimationFrame(update));
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(container);
    }
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [containerRef, update]);

  const jump = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [containerRef]);

  return (
    <div
      className="chat-nav-arrow-wrap chat-nav-arrow-wrap--present"
      aria-hidden={!visible}
    >
      <button
        type="button"
        className={`chat-nav-arrow chat-nav-arrow--present${
          visible ? " chat-nav-arrow--visible" : ""
        }`}
        onClick={jump}
        tabIndex={visible ? 0 : -1}
        aria-label="Jump to latest message"
        title="Jump to present"
      >
        <ArrowDown size={18} />
      </button>
    </div>
  );
});
