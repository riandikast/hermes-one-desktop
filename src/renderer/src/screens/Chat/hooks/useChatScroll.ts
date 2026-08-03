import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when a new user message is sent.
 * - Exposes the container ref and a bottom sentinel ref to be placed in JSX.
 */
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const mountedRef = useRef(false);

  const scrollToBottom = useCallback((force?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // On first mount (opening/resuming a session) jump INSTANTLY to the bottom.
  // Smooth scrollIntoView from an unlaid-out container (content-visibility
  // rows, still-loading images) lands at the top of a long conversation.
  // Re-settle a couple of times so late layout (images, fonts) doesn't leave
  // the view mid-conversation.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    userScrolledUpRef.current = false;
    const container = containerRef.current;
    const jump = (): void => {
      if (container) container.scrollTop = container.scrollHeight;
    };
    jump();
    const raf = requestAnimationFrame(jump);
    const t1 = window.setTimeout(jump, 80);
    const t2 = window.setTimeout(jump, 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Track manual scroll position
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

  // Auto-scroll on incoming messages; force-scroll when user sends a new one
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    const userJustSent =
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user";
    if (userJustSent) {
      userScrolledUpRef.current = false;
      scrollToBottom(true);
    } else {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  return { containerRef, bottomRef };
}
