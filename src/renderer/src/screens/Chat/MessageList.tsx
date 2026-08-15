import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import type { AgentAvatarInfo } from "./MessageRow";
import { ReasoningRow, ToolActivityGroup } from "./HistoryRow";
import { ClarifyCard } from "./ClarifyCard";
import type {
  ChatMessage,
  ClarifyMessage,
  FileChange,
  FileChangesMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

function isToolRow(m: ChatMessage): m is ToolCallMessage | ToolResultMessage {
  const k = (m as { kind?: string }).kind;
  return k === "tool_call" || k === "tool_result";
}

/** Per-turn file-changes chip — its own transcript row, independent of the
 *  answer bubble so a missing final answer can never hide the badge. */
const FileChangesRow = memo(function FileChangesRow({
  msg,
  onOpen,
}: {
  msg: FileChangesMessage;
  onOpen?: (changes: FileChange[]) => void;
}): React.JSX.Element {
  const count = msg.changes.length;
  return (
    <button
      type="button"
      className="chat-file-changes-row"
      onClick={() => onOpen?.(msg.changes)}
      title="View file changes"
    >
      <FilePlus2 size={13} />
      <span>
        {count} file{count > 1 ? "s" : ""} changed
      </span>
      <span className="chat-file-changes-row-arrow">▸</span>
    </button>
  );
});

/** Geometry lookups the nav arrows use to locate user rows. Rows outside the
 *  virtual window are NOT mounted, so the arrows can't use DOM ids — they
 *  read the measured/estimated offsets the virtualizer maintains. */
export interface MessageListModel {
  /** Document-space top (px, relative to the chat-messages container top) of
   *  a stable message, or undefined when the message isn't in the stable
   *  history (it's part of the live streaming tail). */
  getRowTop: (id: string) => number | undefined;
  /** Measured (or estimated) height of a stable message row in px. */
  getRowHeight: (id: string) => number | undefined;
}

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Mark an inline clarify card resolved once the user answers/skips. */
  onClarifyResolved: (requestId: string, answer: string) => void;
  /** Answer transport for inline clarify cards (dashboard WebSocket vs legacy IPC). */
  onClarifyRespond?: (requestId: string, answer: string) => Promise<boolean>;
  /** Appearance of the agent this conversation is with, so idle avatars show
   *  the agent's profile picture instead of the loading gif. */
  agentAvatar?: AgentAvatarInfo;
  /** Per-user-message revert-to-checkpoint button. Runs `/rollback` on the
   *  gateway to restore the working directory snapshot taken before this turn. */
  onRevertCheckpoint?: (msgId: string) => void;
  /** Un-send the most recent user message. Runs `/undo 1` so the gateway
   *  truncates the transcript (no double token), then re-populates the
   *  input box for editing+resend. */
  onUnsendLastUser?: (msgId: string, content: string) => void;
  /** Open the file-changes dialog for a bubble (dashboard transport). */
  onOpenFileChanges?: (changes: FileChange[]) => void;
  /** The chat-messages scroll container (owned by useChatScroll in Chat). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Shared mutable model: MessageList publishes row-geometry lookups here so
   *  the sibling ChatNavArrows can locate user rows without DOM elements. */
  modelRef?: React.MutableRefObject<MessageListModel | null>;
}

function TypingIndicator({
  toolProgress,
  agentAvatar,
}: {
  toolProgress: string | null;
  agentAvatar?: AgentAvatarInfo;
}): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent">
      <HermesAvatar active agent={agentAvatar} />
      <div className="chat-bubble chat-bubble-agent">
        {toolProgress ? (
          <div className="chat-tool-progress">{toolProgress}</div>
        ) : (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bubble messages are filtered to "has content". History items (reasoning,
 * tool_call, tool_result) are *always* shown — they're collapsed by default
 * and the user opens them. Filtering them by content would defeat the point.
 */
function isBubble(m: ChatMessage): m is import("./types").ChatBubbleMessage {
  // Bubble messages have no `kind` field (or kind === "user"/"assistant").
  // History items have kind === "reasoning" | "tool_call" | "tool_result".
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant";
}

/**
 * Build the rows array for a slice of visible messages.
 *
 * @param slice          The subset of visible messages to render.
 * @param sliceStart     The index of slice[0] inside the FULL visible array —
 *                       used for `isLast` / `active` checks against totalLen.
 * @param totalLen       Length of the FULL visible array.
 * @param lastUserIdx    Index of the last user bubble in the FULL visible array.
 * @param prevRole       Role of the row immediately before slice[0] (for showAvatar).
 * @param initReasonId   turnLastReasoningId to start with (usually undefined when
 *                       slice starts right after a user row).
 * @param isLoading      Whether the agent turn is still streaming.
 * @param callbacks      Stable callbacks passed through from the parent.
 */
function buildRows(
  slice: ChatMessage[],
  sliceStart: number,
  totalLen: number,
  lastUserIdx: number,
  prevRole: string | undefined,
  initReasonId: string | undefined,
  isLoading: boolean,
  callbacks: {
    agentAvatar?: AgentAvatarInfo;
    onApprove: () => void;
    onDeny: () => void;
    onClarifyResolved: (requestId: string, answer: string) => void;
    onClarifyRespond?: (requestId: string, answer: string) => Promise<boolean>;
    onRevertCheckpoint?: (msgId: string) => void;
    onUnsendLastUser?: (msgId: string, content: string) => void;
    onOpenFileChanges?: (changes: FileChange[]) => void;
  },
): {
  rows: React.JSX.Element[];
  lastRole: string | undefined;
  turnLastReasoningId: string | undefined;
} {
  const rows: React.JSX.Element[] = [];
  let turnLastReasoningId = initReasonId;
  let lastRole: string | undefined = prevRole;

  for (let si = 0; si < slice.length; si++) {
    const i = sliceStart + si; // index in the full visible array
    const msg = slice[si];
    if (msg.role === "user") turnLastReasoningId = undefined;

    const prev = lastRole;
    lastRole = msg.role;
    const showAvatar = !prev || prev !== msg.role;

    if (isToolRow(msg)) {
      const group: (ToolCallMessage | ToolResultMessage)[] = [];
      const start = si;
      while (si < slice.length && isToolRow(slice[si])) {
        group.push(slice[si] as ToolCallMessage | ToolResultMessage);
        si++;
      }
      si--;
      const globalEnd = sliceStart + si;
      lastRole = "agent";
      rows.push(
        <ToolActivityGroup
          key={`${group[0].id}-${sliceStart + start}`}
          items={group}
          active={isLoading && globalEnd === totalLen - 1}
          isLoading={isLoading}
          showAvatar={
            !slice[start - 1]
              ? !prev || prev !== "agent"
              : slice[start - 1].role !== "agent"
          }
          agent={callbacks.agentAvatar}
          waitForReasoningId={turnLastReasoningId}
        />,
      );
      continue;
    }

    const k = (msg as { kind?: string }).kind;
    if (k === "reasoning") {
      turnLastReasoningId = msg.id;
      rows.push(
        <ReasoningRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "reasoning" }>}
          active={isLoading && i === totalLen - 1}
          showAvatar={showAvatar}
          agent={callbacks.agentAvatar}
        />,
      );
      continue;
    }

    if (k === "clarify") {
      rows.push(
        <ClarifyCard
          key={msg.id}
          msg={msg as ClarifyMessage}
          onResolved={callbacks.onClarifyResolved}
          onRespond={callbacks.onClarifyRespond}
        />
      );
      continue;
    }

    if (k === "file_changes") {
      rows.push(
        <FileChangesRow
          key={msg.id}
          msg={msg as FileChangesMessage}
          onOpen={callbacks.onOpenFileChanges}
        />,
      );
      continue;
    }

    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    rows.push(
      <MessageRow
        key={msg.id}
        msg={bubble}
        isLast={i === totalLen - 1}
        isLoading={isLoading}
        onApprove={callbacks.onApprove}
        onDeny={callbacks.onDeny}
        showAvatar={showAvatar}
        agent={callbacks.agentAvatar}
        onRevertCheckpoint={callbacks.onRevertCheckpoint}
        onUnsendLastUser={callbacks.onUnsendLastUser}
        isLastUser={i === lastUserIdx}
        waitForReasoningId={
          msg.role === "agent" ? turnLastReasoningId : undefined
        }
      />,
    );
  }

  return { rows, lastRole, turnLastReasoningId };
}

/** ── Virtual window ────────────────────────────────────────────────────────
 * Only the rows around the viewport are ever mounted. The stable history is
 * preceded by a top spacer whose height = the total measured height of the
 * rows above the window, so the browser's scrollbar reflects the FULL
 * transcript while the DOM stays bounded (~WINDOW_SIZE rows) no matter how
 * long the session is. Opening a huge session therefore mounts ~100 rows
 * instantly — the old progressive reveal mounted ALL of them over seconds
 * and kept them in the DOM forever.
 *
 * Rows report their REAL height to a shared ResizeObserver; unmounted rows
 * fall back to `estimateRowHeight`. The offsets (prefix sums over the height
 * map) are recomputed per render — O(n) with n = stable rows, ~0.1ms — and
 * the scroll handler slides the window via a binary search.
 *
 * Scroll anchoring stays ON (the default): when the spacer height changes as
 * a consequence of a window slide or a measurement correction, the browser
 * adjusts scrollTop to keep the visible rows fixed — that IS the correct
 * virtualizer compensation (a window slide moves rows, anchoring cancels the
 * move within the frame).
 */
const WINDOW_ROWS_ABOVE = 30;
const WINDOW_ROWS_BELOW = 70;

function estimateRowHeight(m: ChatMessage): number {
  const k = (m as { kind?: string }).kind;
  // Collapsed history rows default to a ~44px summary (28px avatar + 16px
  // row padding). Estimating them at their EXPANDED height was the runaway
  // scroll bug: every scroll-up mounted rows whose real collapsed height was
  // 2-7x smaller than the estimate, so the content above the viewport shrank
  // on every measurement, driving continuous upward drift and inflating
  // scrollHeight (jump-to-present overshot). Collapsed is the steady state;
  // expanded rows are re-measured by the ResizeObserver on mount anyway.
  if (isToolRow(m)) return 44;
  if (k === "reasoning") return 44;
  if (k === "clarify") return 160; // inline question card
  if (k === "file_changes") return 44;
  const content = (m as { content?: string }).content || "";
  // Fenced code blocks collapse to ~180px (max-height); prose wraps at
  // ~90 chars/line. Estimate each collapsed fence at 180px instead of its
  // raw line count — a 100-line code block is ~200px rendered, not ~1200px.
  const fences = content.match(/```/g);
  const fenceCount = fences ? fences.length >> 1 : 0;
  const prose = content.replace(/```[\s\S]*?```/g, "");
  const proseLines = Math.max(1, Math.ceil((prose.length || 1) / 90));
  return Math.min(2400, 44 + (proseLines - 1) * 20 + fenceCount * 180);
}

/** Role + carried reasoning id just before a window boundary — mirrors what
 *  buildRows would have accumulated up to `windowStart` (reasoning resets at
 *  user rows, tool rows imply an agent context). */
function stableWindowContext(
  slice: ChatMessage[],
  windowStart: number,
): { prevRole?: string; initReasonId?: string } {
  if (windowStart <= 0) return {};
  let prevRole: string | undefined;
  let initReasonId: string | undefined;
  for (let i = windowStart - 1; i >= 0; i--) {
    const m = slice[i];
    if (m.role === "user") break;
    if (prevRole === undefined) prevRole = isToolRow(m) ? "agent" : m.role;
    if (!initReasonId && (m as { kind?: string }).kind === "reasoning") {
      initReasonId = m.id;
    }
  }
  return { prevRole, initReasonId };
}

/** First stable-row index whose bottom is at or below scrollTop (clamped to
 *  the last row when the viewport sits in the bottom-spacer/streaming
 *  region). Offsets are prefix sums, so a binary search applies. */
function firstVisibleIndex(
  scrollTop: number,
  offsets: number[],
  len: number,
): number {
  if (len === 0) return 0;
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Row wrapper in the virtual window: owns one ResizeObserver that reports
 *  the row's REAL height into the height map (used for the spacers + arrow
 *  jumps). Its own observer + cleanup means ref identities never churn — a
 *  per-render closure on the host's ref callback would detach/reattach every
 *  mounted row on every streaming delta. */
const MeasureRow = memo(function MeasureRow({
  id,
  onRowHeight,
  children,
}: {
  id: string;
  onRowHeight: (id: string, height: number) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onRowHeightRef = useRef(onRowHeight);
  onRowHeightRef.current = onRowHeight;
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const h =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (h > 0) onRowHeightRef.current(id, h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);
  return (
    <div ref={hostRef} className="chat-virtual-row">
      {children}
    </div>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  onApprove,
  onDeny,
  onClarifyResolved,
  onClarifyRespond,
  agentAvatar,
  onRevertCheckpoint,
  onUnsendLastUser,
  onOpenFileChanges,
  containerRef,
  modelRef,
}: MessageListProps): React.JSX.Element {
  // Bubbles with empty content are still hidden (live-stream placeholders).
  // History rows pass through unconditionally. Agent bubbles streaming live are kept.
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (!isBubble(m)) return true;
        if (!!m.error || m.pending) return true;
        if (
          m.role === "agent" &&
          isLoading &&
          m === messages[messages.length - 1]
        )
          return true;
        return ((m.content as string) || "").trim().length > 0;
      }),
    [messages, isLoading],
  );

  const lastBubble = [...visibleMessages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";

  // Find the last user bubble — this is the boundary between stable history
  // (all prior turns, never changes per delta) and the streaming turn (the
  // current agent turn, re-built on every delta but tiny: ~3–10 rows).
  const lastUserBubbleIdx = (() => {
    for (let j = visibleMessages.length - 1; j >= 0; j--) {
      const m = visibleMessages[j];
      if (isBubble(m) && m.role === "user") return j;
    }
    return -1;
  })();

  // Split: stable = [0, splitAt); streaming = [splitAt, end).
  // The split is AFTER the last user message so the user row is stable too.
  const splitAt = lastUserBubbleIdx >= 0 ? lastUserBubbleIdx + 1 : 0;
  const stableSlice = visibleMessages.slice(0, splitAt);
  const streamingSlice = visibleMessages.slice(splitAt);
  const stableLen = stableSlice.length;

  // ── Height model ─────────────────────────────────────────────────────────
  // id → measured px (real heights only; unmounted rows use estimates).
  const heightMapRef = useRef(new Map<string, number>());
  // Bump to re-render (offsets + spacers) after a batch of measurements.
  const [, setHeightsVersion] = useState(0);
  const heightsVersionRef = useRef(0);

  const onRowHeight = useCallback((id: string, h: number): void => {
    if (h <= 0) return;
    if (heightMapRef.current.get(id) !== h) {
      heightMapRef.current.set(id, h);
    }
    // Batch: many rows mount per window slide; one re-render per frame.
    if (!heightsVersionRef.current) {
      heightsVersionRef.current = requestAnimationFrame(() => {
        heightsVersionRef.current = 0;
        setHeightsVersion((v) => v + 1);
      });
    }
  }, []);

  // Offsets: prefix sums over measured-or-estimated heights. Rebuilt per
  // render (O(n)); the scroll handler reads the latest via ref.
  const offsetsRef = useRef<number[]>([]);
  const stableLenRef = useRef(0);
  stableLenRef.current = stableLen;
  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < stableLen; i++) m.set(stableSlice[i].id, i);
    return m;
  }, [stableSlice, stableLen]);
  const offsets = new Array<number>(stableLen + 1);
  offsets[0] = 0;
  for (let i = 0; i < stableLen; i++) {
    const msg = stableSlice[i];
    offsets[i + 1] =
      offsets[i] + (heightMapRef.current.get(msg.id) ?? estimateRowHeight(msg));
  }
  offsetsRef.current = offsets;

  // Publish the geometry model for the nav arrows (they're siblings — the
  // rows they'd previously query via getElementById may not be mounted).
  const model: MessageListModel = {
    getRowTop: (id) => {
      const i = idToIndex.get(id);
      return i === undefined ? undefined : offsets[i];
    },
    getRowHeight: (id) => {
      const measured = heightMapRef.current.get(id);
      if (measured !== undefined) return measured;
      const i = idToIndex.get(id);
      return i === undefined ? undefined : estimateRowHeight(stableSlice[i]);
    },
  };
  if (modelRef) modelRef.current = model;

  // ── Virtual window state ─────────────────────────────────────────────────
  // Initialized to the BOTTOM window: opening a session shows the present.
  const [windowRange, setWindowRange] = useState<[number, number]>(() => {
    const end = Math.min(stableLen, Math.max(1, stableLen));
    const start = Math.max(0, end - (WINDOW_ROWS_ABOVE + WINDOW_ROWS_BELOW));
    return [start, end];
  });
  const [windowStart, windowEnd] = windowRange;

  const applyWindow = (scrollTop: number): void => {
    const len = stableLenRef.current;
    if (len === 0) {
      setWindowRange((r) => (r[0] === 0 && r[1] === 0 ? r : [0, 0]));
      return;
    }
    const ofs = offsetsRef.current;
    const firstVisible = firstVisibleIndex(scrollTop, ofs, len);
    const start = Math.max(
      0,
      Math.min(firstVisible - WINDOW_ROWS_ABOVE, len - 1),
    );
    const end = Math.min(len, firstVisible + WINDOW_ROWS_BELOW);
    setWindowRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
  };
  const applyWindowRef = useRef(applyWindow);
  applyWindowRef.current = applyWindow;

  // Manual scroll anchoring (the browser's own anchoring is OFF — see
  // .chat-messages overflow-anchor: none). When a measurement corrects row
  // heights (ResizeObserver), the rows ABOVE the viewport shift and would
  // move the content the user is reading. Compensate by the delta of the row
  // that WAS at the viewport top (found by its index under the PREVIOUS
  // offsets), but ONLY when scrollTop hasn't changed between commits — a
  // scrollTop change means the user scrolled (window slide), whose geometry
  // is already self-consistent and must not be compensated. Layout effect =
  // pre-paint, no visible jump.
  const prevOffsetsRef = useRef<number[] | null>(null);
  const prevScrollTopRef = useRef(0);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const len = stableLenRef.current;
    const offsets = offsetsRef.current;
    const prevOffsets = prevOffsetsRef.current;
    const scrollTop = container.scrollTop;
    if (
      len > 0 &&
      prevOffsets &&
      prevOffsets.length === len + 1 &&
      scrollTop === prevScrollTopRef.current
    ) {
      // Measurement correction, no user scroll: keep the same row in place.
      const prevIdx = firstVisibleIndex(scrollTop, prevOffsets, len);
      const delta = offsets[prevIdx] - prevOffsets[prevIdx];
      if (delta !== 0) container.scrollTop += delta;
    }
    prevOffsetsRef.current = offsets;
    prevScrollTopRef.current = scrollTop;
  });

  // Slide the window on scroll / container resize (rAF-throttled).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const schedule = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyWindowRef.current(container.scrollTop);
      });
    };
    container.addEventListener("scroll", schedule, { passive: true });
    schedule();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(container);
    }
    return () => {
      container.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [containerRef]);

  // When the stable transcript GROWS (a turn completed and reconciled) while
  // the window touched the bottom, extend it so the new rows render without
  // waiting for a scroll event (the pinned user must see them appear).
  const prevStableLenRef = useRef(stableLen);
  useEffect(() => {
    const prevLen = prevStableLenRef.current;
    prevStableLenRef.current = stableLen;
    if (stableLen <= prevLen) return;
    setWindowRange(([s, e]) => {
      if (e >= prevLen && e < stableLen) return [s, stableLen];
      return [Math.min(s, Math.max(0, stableLen - 1)), Math.min(e, stableLen)];
    });
  }, [stableLen]);

  // ── Render ───────────────────────────────────────────────────────────────
  const effStart =
    stableLen === 0
      ? 0
      : Math.max(0, Math.min(windowStart, stableLen - 1));
  const effEnd =
    stableLen === 0
      ? 0
      : Math.min(stableLen, Math.max(windowEnd, effStart + 1));
  const topSpacerH = effStart > 0 ? offsets[effStart] : 0;
  const bottomSpacerH =
    stableLen > effEnd ? offsets[stableLen] - offsets[effEnd] : 0;

  const callbacks = {
    agentAvatar,
    onApprove,
    onDeny,
    onClarifyResolved,
    onClarifyRespond,
    onRevertCheckpoint,
    onUnsendLastUser,
    onOpenFileChanges,
  };

  // Window rows: buildRows over the visible window with the context the
  // full-history build would have accumulated by `effStart`.
  const windowCtx = stableWindowContext(stableSlice, effStart);
  const windowRows = buildRows(
    stableSlice.slice(effStart, effEnd),
    effStart,
    visibleMessages.length,
    lastUserBubbleIdx,
    windowCtx.prevRole,
    windowCtx.initReasonId,
    false,
    callbacks,
  ).rows;

  // The streaming turn renders after the bottom spacer; its avatar grouping
  // needs the LAST stable row's effective role (tool rows read as agent).
  const stableLastRole =
    stableLen === 0
      ? undefined
      : isToolRow(stableSlice[stableLen - 1])
        ? "agent"
        : stableSlice[stableLen - 1].role;
  const { rows: streamingRows } = buildRows(
    streamingSlice,
    splitAt,
    visibleMessages.length,
    lastUserBubbleIdx,
    stableLastRole,
    // turnLastReasoningId resets at the user row (last stable row), so start fresh.
    undefined,
    isLoading,
    callbacks,
  );

  return (
    <>
      {topSpacerH > 0 && (
        <div
          className="chat-virtual-spacer chat-virtual-spacer--top"
          style={{ height: topSpacerH }}
          aria-hidden="true"
        />
      )}
      <div className="chat-virtual-window">
        {windowRows.map((row, i) => (
          <MeasureRow
            key={stableSlice[effStart + i].id}
            id={stableSlice[effStart + i].id}
            onRowHeight={onRowHeight}
          >
            {row}
          </MeasureRow>
        ))}
      </div>
      {bottomSpacerH > 0 && (
        <div
          className="chat-virtual-spacer chat-virtual-spacer--bottom"
          style={{ height: bottomSpacerH }}
          aria-hidden="true"
        />
      )}
      {streamingRows}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator
          toolProgress={toolProgress}
          agentAvatar={agentAvatar}
        />
      )}

      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
