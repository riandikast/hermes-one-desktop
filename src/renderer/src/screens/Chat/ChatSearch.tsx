import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  findChatMatches,
  stepMatchIndex,
  type ChatSearchMatch,
} from "./chatTextSearch";
import type { ChatMessage } from "./types";

/** Custom Highlight names (Chromium CSS Custom Highlight API). */
const ALL_HIGHLIGHT = "chat-search-all";
const ACTIVE_HIGHLIGHT = "chat-search-active";
/**
 * Class fallback for the active match's row. Markdown rewrites text before it
 * reaches the DOM, so the precise occurrence index from the model can miss —
 * the row outline guarantees the navigation target is still visible.
 */
const ACTIVE_HIT_CLASS = "chat-search-hit";
/**
 * Matching re-scans every message in the session, so the query used for
 * matching is debounced: on a multi-megabyte transcript an immediate scan per
 * keystroke would stall typing. The input value itself stays instant.
 */
const QUERY_DEBOUNCE_MS = 120;

type HighlightRegistry = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};

type HighlightCtor = new (...ranges: Range[]) => unknown;

/**
 * The transcript row for a message. Prefers the copy inside the scroll
 * container: a pinned bubble renders the SAME `chat-msg-<id>` in the pinned bar
 * above the transcript, and scrolling that copy would scroll nothing.
 */
function findRow(
  container: HTMLElement | null,
  messageId: string,
): HTMLElement | null {
  const selector = `[id="chat-msg-${messageId.replace(/"/g, '\\"')}"]`;
  const scoped = container?.querySelector<HTMLElement>(selector);
  if (scoped) return scoped;
  return document.querySelector<HTMLElement>(selector);
}

/**
 * The CSS Custom Highlight API is Chromium-only and absent under jsdom, so it
 * is resolved defensively — highlighting is a progressive enhancement over the
 * match counter, which always works.
 */
function highlightSupport(): {
  registry: HighlightRegistry;
  Highlight: HighlightCtor;
} | null {
  const registry = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } })
    .CSS?.highlights;
  const Highlighter = (globalThis as unknown as { Highlight?: HighlightCtor })
    .Highlight;
  if (!registry || typeof Highlighter !== "function") return null;
  return { registry, Highlight: Highlighter };
}

export interface ChatSearchProps {
  messages: ChatMessage[];
  /** The scroll container that holds the rendered transcript. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raise MessageList's render budget so a collapsed match can be shown. */
  onRevealMessage?: (messageId: string) => void;
  /**
   * Called right before scrolling to a match. The chat uses it to mark itself
   * scrolled-up so the streaming auto-snap does not yank the viewport away
   * from the match the user just navigated to.
   */
  onBeforeScroll?: () => void;
}

/**
 * Floating in-chat search: a Chrome-style find bar that searches the WHOLE
 * session (not just the rendered window) with match navigation.
 */
export function ChatSearch({
  messages,
  containerRef,
  open,
  onOpenChange,
  onRevealMessage,
  onBeforeScroll,
}: ChatSearchProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [paintTick, setPaintTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (deferredQuery === query) return;
    const timer = window.setTimeout(
      () => setDeferredQuery(query),
      QUERY_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query, deferredQuery]);

  const matches = useMemo(
    () => findChatMatches(messages, deferredQuery),
    [messages, deferredQuery],
  );

  // A new query starts at its first match.
  useEffect(() => {
    setActiveIndex(matches.length > 0 ? 0 : -1);
  }, [deferredQuery, matches.length]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  const clear = useCallback((): void => {
    setQuery("");
    setDeferredQuery("");
    setActiveIndex(-1);
  }, []);

  const close = useCallback((): void => {
    clear();
    onOpenChange(false);
  }, [clear, onOpenChange]);

  const scrollToMatch = useCallback(
    (match: ChatSearchMatch | undefined): void => {
      if (!match) return;
      // Break the transcript's stick-to-bottom lock first, otherwise the
      // auto-follow yanks the viewport back to the bottom mid-jump.
      onBeforeScroll?.();
      const container = containerRef?.current ?? null;
      let attempts = 0;
      const attempt = (): void => {
        const row = findRow(container, match.messageId);
        if (row) {
          row.scrollIntoView?.({ block: "center", behavior: "smooth" });
          // Repaint once the jump lands: rows that mount as the rendered
          // window expands can hold stale highlight ranges.
          setPaintTick((tick) => tick + 1);
          return;
        }
        // The row may not be mounted yet (collapsed turn being revealed), and
        // expanding the window on a long session can take a few hundred ms.
        if (attempts++ < 20) window.setTimeout(attempt, 80);
      };
      // Wait a frame so a just-revealed window has committed.
      window.requestAnimationFrame(attempt);
    },
    [containerRef, onBeforeScroll],
  );

  const go = useCallback(
    (direction: 1 | -1): void => {
      if (matches.length === 0) return;
      const next = stepMatchIndex(activeIndex, matches.length, direction);
      setActiveIndex(next);
      const target = matches[next];
      if (!target) return;
      onRevealMessage?.(target.messageId);
      scrollToMatch(target);
    },
    [activeIndex, matches, onRevealMessage, scrollToMatch],
  );

  // Paint matches onto the rendered transcript. Rebuilt whenever the match set,
  // the active match, or the rendered DOM changes (rows mount/unmount as the
  // transcript streams or a collapsed turn is revealed).
  useEffect(() => {
    const container = containerRef?.current;
    const support = highlightSupport();
    const clearPaint = (): void => {
      support?.registry.delete(ALL_HIGHLIGHT);
      support?.registry.delete(ACTIVE_HIGHLIGHT);
      for (const el of document.querySelectorAll(`.${ACTIVE_HIT_CLASS}`)) {
        el.classList.remove(ACTIVE_HIT_CLASS);
      }
    };
    if (!container || !open || !deferredQuery) {
      clearPaint();
      return;
    }

    const paint = (): void => {
      clearPaint();
      const lowerQuery = deferredQuery.toLowerCase();
      const active = activeIndex >= 0 ? matches[activeIndex] : undefined;
      const ranges: Range[] = [];
      const seen = new Set<string>();
      let activeRange: Range | null = null;

      for (const match of matches) {
        if (seen.has(match.messageId)) continue;
        seen.add(match.messageId);
        const row = findRow(container, match.messageId);
        if (!row || !container.contains(row)) continue;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let occurrence = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.nodeValue ?? "";
          if (!text) continue;
          const haystack = text.toLowerCase();
          let from = 0;
          for (;;) {
            const at = haystack.indexOf(lowerQuery, from);
            if (at === -1) break;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + lowerQuery.length);
            ranges.push(range);
            if (
              active &&
              active.messageId === match.messageId &&
              occurrence === active.indexInMessage
            ) {
              activeRange = range;
            }
            occurrence += 1;
            from = at + lowerQuery.length;
          }
        }
        if (active && active.messageId === match.messageId) {
          row.classList.add(ACTIVE_HIT_CLASS);
        }
      }

      if (!support) return;
      if (ranges.length > 0) {
        support.registry.set(ALL_HIGHLIGHT, new support.Highlight(...ranges));
      }
      if (activeRange) {
        support.registry.set(
          ACTIVE_HIGHLIGHT,
          new support.Highlight(activeRange),
        );
      }
    };

    let frame = window.requestAnimationFrame(paint);
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(paint);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      clearPaint();
    };
  }, [activeIndex, containerRef, deferredQuery, matches, open, paintTick]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        go(event.shiftKey ? -1 : 1);
      }
    },
    [close, go],
  );

  const position = matches.length > 0 ? activeIndex + 1 : 0;

  return (
    <div className="chat-search">
      <button
        type="button"
        className={`chat-search-trigger${open ? " chat-search-trigger--active" : ""}`}
        aria-label="Search in chat"
        aria-expanded={open}
        title="Search in chat"
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <Search size={16} />
      </button>
      {open && (
        <div className="chat-search-bar" role="search">
          <Search size={14} className="chat-search-glyph" aria-hidden />
          <input
            ref={inputRef}
            className="chat-search-input"
            type="text"
            value={query}
            placeholder="Search in chat"
            aria-label="Search text in chat"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="chat-search-count" aria-live="polite">
            {position}/{matches.length}
          </span>
          <button
            type="button"
            className="chat-search-step"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            disabled={matches.length === 0}
            onClick={() => go(-1)}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="chat-search-step"
            aria-label="Next match"
            title="Next match (Enter)"
            disabled={matches.length === 0}
            onClick={() => go(1)}
          >
            <ChevronDown size={14} />
          </button>
          <span className="chat-search-divider" aria-hidden />
          <button
            type="button"
            className="chat-search-close"
            aria-label="Close search"
            title="Close (Esc)"
            onClick={close}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
