import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Mark an inline clarify card resolved once the user answers/skips. */
  onClarifyResolved: (requestId: string, answer: string) => void;
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
  /** Fired after EVERY progressive-reveal batch lands (long sessions only)
   *  with the batch's REAL prepended height — the owner shifts scrollTop by
   *  it (manual anchoring): a scrolled-up user keeps their place, the
   *  bottom-pinned user stays at the present.
   */
  onRevealBatchApplied?: (deltaPx: number) => void;
  /** Fired when the progressive reveal starts/stops — the owner toggles
   *  scroll anchoring off during it (prepends would otherwise fight the
   *  per-batch snaps) and back on afterwards for normal scrolling. */
  onRevealStateChange?: (active: boolean) => void;
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
        />,
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

/** Stable wrapper — only re-renders when `rows` identity changes (i.e. when
 *  the history changes, NOT on every streaming delta). */
const rowId = (id: string): string => `chat-msg-${id}`;

const StableHistory = memo(function StableHistory({
  rows,
  revealing,
}: {
  rows: React.JSX.Element[];
  revealing: boolean;
}): React.JSX.Element {
  // While the progressive reveal is active the rows must lay out at REAL
  // heights (see .chat-stable-reveal) — the per-batch snap reads
  // scrollHeight, and content-visibility's 120px first-paint estimates made
  // the content end move whenever a freshly prepended batch entered the
  // viewport (the visible clip/unclip blink).
  return revealing ? <div className="chat-stable-reveal">{rows}</div> : <>{rows}</>;
});

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  onApprove,
  onDeny,
  onClarifyResolved,
  agentAvatar,
  onRevertCheckpoint,
  onUnsendLastUser,
  onOpenFileChanges,
  onRevealBatchApplied,
  onRevealStateChange,
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

  // ── Progressive stable-history reveal ─────────────────────────────────────
  // Opening a long session mounts every stable row at once — React still
  // creates all the DOM nodes even with content-visibility: auto, freezing
  // the UI thread for a beat. Render only the trailing INITIAL rows and
  // prepend the rest in small batches; Chromium's scroll anchoring keeps the
  // viewport stable while older rows land above. buildRows receives the
  // ABSOLUTE start offset so reasoning-group keys (index-based) stay stable
  // as rows are prepended — otherwise every batch would remount rows.
  const INITIAL_STABLE_ROWS = 120;
  const STABLE_ROW_BATCH = 40;
  const [revealedStableCount, setRevealedStableCount] = useState(() =>
    Math.min(INITIAL_STABLE_ROWS, stableSlice.length),
  );
  const revealDoneRef = useRef(false);
  // Manual anchoring for the reveal: the batches PREPEND above the
  // viewport. Measure the stable tail's offsetTop delta (the batch's REAL
  // prepended height — streaming appends below don't move it) and pass it
  // to the owner, which shifts scrollTop by it — the viewport content stays
  // put for a scrolled-up user AND the bottom-pinned user stays pinned.
  const prevStableTailOffsetRef = useRef(0);
  // Set once when the reveal COMPLETES; never reset. Subsequent transcript
  // growth (a new turn) then reveals the tail in ONE shot instead of
  // re-running the batch machinery per streaming delta.
  const revealCompletedRef = useRef(false);
  const revealActiveReportedRef = useRef(false);
  const revealStart = stableSlice.length - revealedStableCount;
  const revealedStable = stableSlice.slice(revealStart);
  // The measurement anchor: the LAST row of the revealed stable slice is a
  // USER row (splitAt = lastUserBubbleIdx + 1) — MessageRow gives user rows
  // the `chat-msg-<id>` DOM id (assistant rows don't), so it's findable.
  const stableTail =
    revealedStable.length > 0
      ? revealedStable[revealedStable.length - 1]
      : undefined;
  // Layout effect: the batch has already rendered (DOM mutated) by this
  // point. Measure the stable tail's offsetTop delta — the batch's REAL
  // prepended height — and pass it to the owner for the scrollTop shift
  // (manual anchoring, same frame, no drift frame ever paints).
  useLayoutEffect(() => {
    let delta = 0;
    if (stableTail) {
      const tailEl = document.getElementById(rowId(stableTail.id));
      const ot = tailEl ? tailEl.offsetTop : 0;
      if (prevStableTailOffsetRef.current > 0) {
        delta = ot - prevStableTailOffsetRef.current;
      }
      prevStableTailOffsetRef.current = ot;
    }
    if (revealedStableCount >= stableSlice.length) {
      // Reveal finished — if it actually revealed anything (long session),
      // shift by the last batch's delta, and tell the owner the reveal
      // ended (it re-enables scroll anchoring for normal scrolling).
      if (!revealDoneRef.current) {
        revealDoneRef.current = true;
        revealCompletedRef.current = true;
        if (revealActiveReportedRef.current) {
          revealActiveReportedRef.current = false;
          onRevealStateChange?.(false);
        }
        if (delta > 0) onRevealBatchApplied?.(delta);
      }
      return;
    }
    revealDoneRef.current = false;
    if (!revealActiveReportedRef.current) {
      revealActiveReportedRef.current = true;
      onRevealStateChange?.(true);
    }
    if (delta > 0) onRevealBatchApplied?.(delta);
  }, [revealedStableCount, stableSlice.length, onRevealBatchApplied, onRevealStateChange, stableTail]);

  useEffect(() => {
    if (revealedStableCount >= stableSlice.length) return;
    // Growth AFTER the reveal completed (a new turn landed): reveal the new
    // tail in ONE shot — the batch machinery is only for the initial open.
    if (revealCompletedRef.current) {
      setRevealedStableCount(stableSlice.length);
      return;
    }
    // Two rAF hops = one full paint cycle between batches, so each chunk
    // lands in its own frame instead of stacking in a single busy frame.
    let raf = 0;
    const t = setTimeout(() => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          setRevealedStableCount((c) =>
            Math.min(stableSlice.length, c + STABLE_ROW_BATCH),
          );
        });
      });
    }, 0);
    return () => {
      clearTimeout(t);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [revealedStableCount, stableSlice.length]);

  // ── Stable history rows ────────────────────────────────────────────────────
  // Cached so they rebuild only when the history changes (user sends, revert,
  // unsend, end-of-stream reconcile) — NOT on every streaming delta. This
  // turns the per-delta O(n_total) element-creation cost into O(n_turn).
  // The cache check is O(1): every message update is immutable (state updates
  // spread/replace objects), so the LAST stable message's object reference is
  // identical across streaming deltas and only changes when the history
  // actually changed (a reconcile recreates every row object, so mid-history
  // edits are caught too). agentAvatar identity is also part of the key: it
  // can change (appearance / profile switch) without any message changing.
  const stableCacheRef = useRef<{
    tail: ChatMessage | undefined;
    len: number;
    avatarKey: string;
    rows: React.JSX.Element[];
    lastRole: string | undefined;
    turnLastReasoningId: string | undefined;
  }>({
    tail: undefined,
    len: 0,
    avatarKey: "",
    rows: [],
    lastRole: undefined,
    turnLastReasoningId: undefined,
  });

  const avatarKey = agentAvatar ? "a" : "n";
  if (
    stableCacheRef.current.tail !== stableTail ||
    stableCacheRef.current.len !== revealedStable.length ||
    stableCacheRef.current.avatarKey !== avatarKey
  ) {
    // Stable history changed — rebuild. Stable rows are NEVER streaming-active.
    const callbacks = {
      agentAvatar,
      onApprove,
      onDeny,
      onClarifyResolved,
      onRevertCheckpoint,
      onUnsendLastUser,
      onOpenFileChanges,
    };
    const prev = stableCacheRef.current;
    let rows: React.JSX.Element[];
    let lastRole = prev.lastRole;
    let turnLastReasoningId = prev.turnLastReasoningId;
    if (
      prev.len > 0 &&
      prev.tail === stableTail &&
      revealedStable.length > prev.len
    ) {
      // Pure PREPEND (progressive reveal): build only the newly revealed
      // leading rows and prepend them. Absolute-index keys keep the cached
      // rows' keys stable, so React mounts just the new chunk — the per-batch
      // cost stays O(batch) instead of O(revealed) (which made the later
      // batches of a long session visibly stutter).
      const fresh = revealedStable.slice(0, revealedStable.length - prev.len);
      rows = buildRows(
        fresh,
        revealStart,
        visibleMessages.length,
        lastUserBubbleIdx,
        undefined,
        undefined,
        false,
        callbacks,
      ).rows;
      rows = [...rows, ...prev.rows];
    } else {
      // History changed mid-list or first build — full rebuild.
      const result = buildRows(
        revealedStable,
        revealStart,
        visibleMessages.length,
        lastUserBubbleIdx,
        undefined,
        undefined,
        false,
        callbacks,
      );
      rows = result.rows;
      lastRole = result.lastRole;
      turnLastReasoningId = result.turnLastReasoningId;
    }
    stableCacheRef.current = {
      tail: stableTail,
      len: revealedStable.length,
      avatarKey,
      rows,
      lastRole,
      turnLastReasoningId,
    };
  }
  const { rows: stableRows, lastRole: stableLastRole } = stableCacheRef.current;

  // ── Streaming turn rows ────────────────────────────────────────────────────
  // Re-built on every delta, but the slice is tiny (the current agent turn).
  const callbacks = {
    agentAvatar,
    onApprove,
    onDeny,
    onClarifyResolved,
    onRevertCheckpoint,
    onUnsendLastUser,
    onOpenFileChanges,
  };
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
      <StableHistory
        rows={stableRows}
        revealing={revealedStableCount < stableSlice.length}
      />
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
