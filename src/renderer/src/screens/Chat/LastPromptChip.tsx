import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownRight, Maximize2 } from "lucide-react";
import type { ChatBubbleMessage, ChatMessage } from "./types";
import { isBubbleMessage } from "./chatMessages";
import { isAutoInjectedPrompt } from "./autoPrompts";
import { HighlightedText } from "./HighlightedText";
import { useAtomValue } from "./hooks/useChatScrollAtoms";
import { FloatingDialog } from "./FloatingDialog";

/**
 * A floating chip that shows the LAST user prompt, so an old conversation can
 * be identified without scrolling to the bottom.
 *
 * Placement differs from the pinned bar on purpose: this does NOT spawn at the
 * middle-top of the transcript (pinned messages do). It sits at the TOP-LEFT of
 * the scrollport as a compact one-line chip, and it only appears while the user
 * is scrolled UP — at the bottom the real last prompt is already on screen, so
 * a duplicate bubble over the content would be noise.
 *
 * Clicking opens the FULL prompt in a dialog rather than scrolling the
 * transcript to it. A scroll-based jump proved fragile: the target row may be
 * virtualised out of the DOM (nothing to scroll to), and the stick-to-bottom
 * auto-follow fights a programmatic scroll. A dialog sidesteps both — it always
 * shows the complete prompt, and long ones scroll inside it.
 *
 * Absolutely positioned against the scrollport's PARENT (see .chat-body), never
 * sticky inside the scroller: a sticky element only sticks within its parent's
 * bounds, so one placed late in the content flow scrolls out of view.
 */

/** Single-line preview cap for the pill. The dialog shows the full text. */
const PREVIEW_MAX = 140;

/**
 * How many recent prompts the dialog lists. The chip's single newest prompt is
 * ambiguous when auto-notices arrived after it; a few prompts let the user
 * identify the conversation even if detection ever misjudges a row.
 */
const RECENT_PROMPT_LIMIT = 5;

/**
 * How long the container must stay non-scrollable before the chip hides.
 *
 * The virtual window UNMOUNTS rows below and MOUNTS rows above while scrolling,
 * and during that hand-off `scrollHeight` momentarily collapses — so a naive
 * read flips scrollable true→false→true and the chip blinks out mid-scroll
 * ("shows one second, then disappears"). Only a SUSTAINED loss of overflow
 * (the chat really is short again) hides it.
 */
const SCROLLABLE_LOSS_GRACE_MS = 400;

/** Plain-text preview of a message's content (never renders markup). */
export function lastPromptPreview(
  content: string,
  limit = PREVIEW_MAX,
): string {
  const collapsed = String(content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return "";
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed;
}

/**
 * The last USER message in the transcript — the prompt this chip represents.
 * Returns null when there is nothing worth showing (no user message, or the
 * last one has no text, e.g. an attachment-only turn).
 *
 * Auto-injected rows are SKIPPED. The runtime writes its own notices into the
 * same `role="user"` stream (background-process completion, delegation batch
 * reports, compaction handoffs, model-change notices), so the newest user row
 * is frequently NOT what the user typed — that is exactly the "last prompt got
 * mixed by auto background task report prompt" report. See `autoPrompts.ts`.
 */
export function findLastPrompt(
  messages: ReadonlyArray<ChatMessage>,
): ChatBubbleMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    // Only real bubbles carry a prompt; overlay rows (reasoning/tool/clarify)
    // and non-user rows are skipped.
    if (!isBubbleMessage(m) || m.role !== "user") continue;
    if (!String(m.content ?? "").trim()) continue;
    // A runtime injection is not a prompt the user wrote.
    if (isAutoInjectedPrompt(String(m.content ?? ""))) continue;
    return m;
  }
  return null;
}

/**
 * The newest `limit` USER prompts, newest first, with runtime injections
 * excluded.
 *
 * The chip shows only the single newest one, which is ambiguous when several
 * auto-notices arrived after a real prompt. The dialog lists these so the user
 * can identify the conversation even if detection ever misjudges a row — the
 * list is the safety net behind the detector, not a replacement for it.
 */
export function findRecentPrompts(
  messages: ReadonlyArray<ChatMessage>,
  limit = 5,
): ChatBubbleMessage[] {
  const out: ChatBubbleMessage[] = [];
  if (limit <= 0) return out;
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const m = messages[i];
    if (!isBubbleMessage(m) || m.role !== "user") continue;
    if (!String(m.content ?? "").trim()) continue;
    if (isAutoInjectedPrompt(String(m.content ?? ""))) continue;
    out.push(m);
  }
  return out;
}

/**
 * Is the transcript scrollable enough to navigate?
 *
 * Deliberately compares against a small positive epsilon rather than the
 * bottom-proximity tolerance: this asks "can it overflow at all?", which is a
 * different question from "are we near the bottom?".
 */
export function isScrollable(
  scrollHeight: number,
  clientHeight: number,
  epsilonPx = 4,
): boolean {
  return scrollHeight - clientHeight > epsilonPx;
}

/**
 * Whether the chip should be painted, given the settled scrollable state and
 * the live scrolled-up flag.
 *
 * Split out because the ANSWER is trivial while the TIMING is not: scrollable
 * is debounced on the way down (see SCROLLABLE_LOSS_GRACE_MS), and this keeps
 * the actual visibility rule in one readable place.
 */
export function shouldShowLastPromptChip(
  scrollable: boolean,
  scrolledUp: boolean,
): boolean {
  // Only while scrolled up: at the bottom the real prompt is already on screen,
  // so the chip would be a duplicate floating over it.
  return scrollable && scrolledUp;
}

export const LastPromptChip = memo(function LastPromptChip({
  messages,
  containerRef,
  scrolledUpAtom,
}: {
  messages: ReadonlyArray<ChatMessage>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Same pinned-state mirror the "jump to present" button uses, so visibility
   *  stays in lock-step with the scroll hook (its handlers are the only
   *  writer). */
  scrolledUpAtom?: {
    get: () => boolean;
    subscribe: (l: () => void) => () => void;
  };
}): React.JSX.Element | null {
  const fallback = { get: () => false, subscribe: () => () => {} };
  const scrolledUp = useAtomValue(scrolledUpAtom ?? fallback);
  const containerRefLocal = containerRef;
  const [scrollable, setScrollable] = useState(false);
  // The full-prompt dialog. Reading a long prompt happens there, not by
  // scrolling the transcript (which virtualisation + auto-follow made flaky).
  const [open, setOpen] = useState(false);
  // "Copied" acknowledgement, keyed by the prompt text that was copied so the
  // right row lights up in the list.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timer for the debounced loss of overflow (see SCROLLABLE_LOSS_GRACE_MS).
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest scrollable value, so the debounce can compare without re-binding.
  const scrollableRef = useRef(false);

  const updateScrollable = useCallback(() => {
    const container = containerRefLocal.current;
    if (!container) return;
    const next = isScrollable(container.scrollHeight, container.clientHeight);
    if (next) {
      // Regaining overflow applies IMMEDIATELY — the chip should come back the
      // moment there is something to scroll, with no delay.
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (!scrollableRef.current) {
        scrollableRef.current = true;
        setScrollable(true);
      }
      return;
    }
    // Losing overflow is DELAYED: the virtual window's mount/unmount hand-off
    // briefly collapses scrollHeight mid-scroll, and hiding on that transient
    // is what made the chip blink out. Only a sustained loss hides it.
    if (!scrollableRef.current || hideTimerRef.current !== null) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      // Re-check at the deadline rather than trusting the earlier read.
      const el = containerRefLocal.current;
      if (!el) return;
      if (isScrollable(el.scrollHeight, el.clientHeight)) return;
      scrollableRef.current = false;
      setScrollable(false);
    }, SCROLLABLE_LOSS_GRACE_MS);
  }, [containerRefLocal]);

  useEffect(() => {
    updateScrollable();
    const container = containerRef.current;
    if (!container) return;
    // Re-measure on scroll too: scrollHeight changes as the virtual window
    // swaps rows, and the ResizeObserver only fires on the container's own box.
    container.addEventListener("scroll", updateScrollable, { passive: true });
    window.addEventListener("resize", updateScrollable);
    // A short chat is not scrollable and must never show the chip; the first
    // measurement can land before layout settles, so re-read a couple of frames
    // later.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(updateScrollable),
    );
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateScrollable);
      observer.observe(container);
    }
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("scroll", updateScrollable);
      window.removeEventListener("resize", updateScrollable);
      observer?.disconnect();
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [containerRef, updateScrollable]);

  // No user prompt at all -> nothing to show.
  const lastPrompt = findLastPrompt(messages);
  const preview = lastPrompt
    ? lastPromptPreview(String(lastPrompt.content ?? ""))
    : "";

  const openDialog = useCallback(() => setOpen(true), []);

  /**
   * Copy one prompt. Keeps the per-row "Copied" acknowledgement keyed by row id
   * so a click on row 3 does not light up row 1.
   */
  const copyText = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await window.hermesAPI.copyToClipboard(text);
      setCopiedId(text);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopiedId(null);
      }, 2000);
    } catch {
      // Clipboard write can fail in some environments; leave the button as-is.
    }
  }, []);

  // Never let the acknowledgement timer outlive the component.
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  // The list shown in the dialog. Newest first, injections excluded. Falls back
  // to the single resolved prompt when the transcript only has one.
  const recent = findRecentPrompts(messages, RECENT_PROMPT_LIMIT);
  // Which rows are expanded to full text. Default: the newest only, so the list
  // stays scannable and a huge prompt does not swamp the dialog on open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleRow = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (!lastPrompt || !preview) return null;

  // Keep the chip on screen while its dialog is open — closing the dialog
  // should not leave the user wondering where the chip went because the scroll
  // position moved underneath it.
  const visible = open || shouldShowLastPromptChip(scrollable, scrolledUp);
  const rows = recent.length > 0 ? recent : [lastPrompt];

  return (
    <>
      <div className="chat-last-prompt-wrap" aria-hidden={!visible}>
        <button
          type="button"
          className={`chat-last-prompt${
            visible ? " chat-last-prompt--visible" : ""
          }`}
          onClick={openDialog}
          tabIndex={visible ? 0 : -1}
          title={`Show full prompt: ${preview}`}
          aria-label={`Show full last prompt: ${preview}`}
        >
          <span className="chat-last-prompt-icon" aria-hidden>
            <CornerDownRight size={13} />
          </span>
          <span className="chat-last-prompt-label">Last prompt</span>
          <span className="chat-last-prompt-text">{preview}</span>
          <Maximize2
            size={11}
            className="chat-last-prompt-expand"
            aria-hidden
          />
        </button>
      </div>

      {/* Mounted only while open — nothing here is expensive or stateful to
          recreate (unlike the terminal panels, which need keepMounted). */}
      {open && (
        <FloatingDialog
          open={open}
          onClose={() => setOpen(false)}
          title="Recent prompts"
          size="wide"
          className="last-prompt-dialog"
        >
          <div className="chat-last-prompt-dialog">
            <div className="chat-last-prompt-dialog-head">
              <span className="chat-last-prompt-dialog-label">
                {rows.length > 1
                  ? `Last ${rows.length} prompts`
                  : "Last prompt"}
              </span>
              <span className="chat-last-prompt-dialog-note">
                Auto-generated notices are hidden
              </span>
            </div>
            <ul className="chat-last-prompt-list">
              {rows.map((row, index) => {
                const text = String(row.content ?? "").trim();
                const oneLine = lastPromptPreview(text, 220);
                const isOpen = expanded[row.id] ?? false;
                const isNewest = index === 0;
                return (
                  <li
                    key={row.id}
                    className={`chat-last-prompt-item${
                      isNewest ? " chat-last-prompt-item--newest" : ""
                    }`}
                  >
                    <div className="chat-last-prompt-item-head">
                      <span className="chat-last-prompt-item-index">
                        {isNewest ? "Latest" : `#${index + 1}`}
                      </span>
                      <button
                        type="button"
                        className="chat-last-prompt-item-toggle"
                        onClick={() => toggleRow(row.id)}
                        aria-expanded={isOpen}
                        title={isOpen ? "Collapse prompt" : "Expand prompt"}
                      >
                        {isOpen ? "Collapse" : "Expand"}
                      </button>
                      <button
                        type="button"
                        className="chat-last-prompt-item-copy"
                        onClick={() => void copyText(text)}
                        title={
                          copiedId === text ? "Copied!" : "Copy this prompt"
                        }
                        aria-label={
                          copiedId === text
                            ? `Copied prompt ${index + 1}`
                            : `Copy prompt ${index + 1}`
                        }
                      >
                        {copiedId === text ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                    {isOpen ? (
                      <HighlightedText
                        text={text}
                        tone="prompt"
                        className="chat-last-prompt-item-body"
                      />
                    ) : (
                      <p className="chat-last-prompt-item-preview">{oneLine}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </FloatingDialog>
      )}
    </>
  );
});
