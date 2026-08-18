import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, startTransition } from "react";
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
import { forkTranscriptWeight } from "./forkTranscriptWeight";
import {
  RENDER_BUDGET,
  MIN_VISIBLE_GROUPS,
  FIRST_PAINT_BUDGET,
  LIVE_TAIL_WEIGHT,
  LIVE_TAIL_MIN_GROUPS,
  LIVE_TAIL_MAX_GROUPS,
  buildTranscriptGroups,
  firstVisibleGroupIndex,
  liveTailStart,
  type TranscriptGroup,
} from "./forkTranscriptWindow";

function isToolRow(m: ChatMessage): m is ToolCallMessage | ToolResultMessage {
  const k = (m as { kind?: string }).kind;
  return k === "tool_call" || k === "tool_result";
}

/** Per-turn file-changes chip */
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

/** Geometry for ChatNavArrow: only visible groups have DOM; older turns are hidden, not estimated. */
export interface MessageListModel {
  getRowTop: (id: string) => number | undefined;
  getRowHeight: (id: string) => number | undefined;
}

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  onClarifyResolved: (requestId: string, answer: string) => void;
  onClarifyRespond?: (requestId: string, answer: string) => Promise<boolean>;
  agentAvatar?: AgentAvatarInfo;
  onRevertCheckpoint?: (msgId: string) => void;
  onUnsendLastUser?: (msgId: string, content: string) => void;
  onOpenFileChanges?: (changes: FileChange[]) => void;
  /** Provided by Chat.tsx (useOfficialChatScroll): scroll container for anchoring. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  modelRef?: React.MutableRefObject<MessageListModel | null>;
  /** Session key for first-paint budget resets (e.g. hermesSessionId). */
  sessionKey?: string | null;
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

function isBubble(m: ChatMessage): m is import("./types").ChatBubbleMessage {
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant";
}

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
    const i = sliceStart + si;
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

/**
 * Render-budget transcript (official-style, no virtualizer).
 *
 * Groups are user-turns. Budget is weighted render cost, not row count.
 * "Show earlier" hydrates hidden groups. Live tail is always-rendered so
 * its layout is settled before it can be virtualized (no height-snap drift).
 * Fork keeps the same buildRows + row components; only the windowing changes.
 */
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
  sessionKey,
}: MessageListProps): React.JSX.Element {
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
  const lastUserBubbleIdx = (() => {
    for (let j = visibleMessages.length - 1; j >= 0; j--) {
      const m = visibleMessages[j];
      if (isBubble(m) && m.role === "user") return j;
    }
    return -1;
  })();

  // Structural signature (ids + roles) keys groups; weight ticks separately.
  const structuralSig = useMemo(
    () => visibleMessages.map((m, i) => `${i}:${m.id}:${(m as { role?: string }).role ?? (m as { kind?: string }).kind ?? "x"}`).join("\n"),
    [visibleMessages],
  );
  const weights = useMemo(
    () => forkTranscriptWeight(visibleMessages),
    [visibleMessages],
  );
  const groups: TranscriptGroup[] = useMemo(
    () => buildTranscriptGroups(visibleMessages, weights),
    [visibleMessages, weights],
  );

  // First-paint budget: small on session switch to keep switch instant.
  const [renderBudget, setRenderBudget] = useState(FIRST_PAINT_BUDGET);
  const [budgetSessionKey, setBudgetSessionKey] = useState(sessionKey ?? null);
  const [hadGroups, setHadGroups] = useState(groups.length > 0);
  const hasGroups = groups.length > 0;
  const restoreFromBottomRef = useRef<number | null>(null);

  if (budgetSessionKey !== (sessionKey ?? null)) {
    setBudgetSessionKey(sessionKey ?? null);
    setHadGroups(hasGroups);
    setRenderBudget(FIRST_PAINT_BUDGET);
  } else if (hadGroups !== hasGroups) {
    setHadGroups(hasGroups);
    if (hasGroups) setRenderBudget(FIRST_PAINT_BUDGET);
  }

  const anchorBeforePrepend = useCallback(() => {
    const el = containerRef?.current;
    restoreFromBottomRef.current = el ? el.scrollHeight - el.scrollTop : 0;
  }, [containerRef]);

  useEffect(() => {
    if (renderBudget >= RENDER_BUDGET) return;
    const raf = requestAnimationFrame(() => {
      anchorBeforePrepend();
      startTransition(() => setRenderBudget((b) => Math.max(b, RENDER_BUDGET)));
    });
    return () => cancelAnimationFrame(raf);
  }, [anchorBeforePrepend, renderBudget]);

  // Groups are already weighted; derive hiddenCount from the real group weights.
  const realHiddenCount = useMemo(
    () => firstVisibleGroupIndex(groups, renderBudget, renderBudget >= RENDER_BUDGET ? MIN_VISIBLE_GROUPS : 0),
    [groups, renderBudget],
  );
  const visibleGroups = useMemo(
    () => (realHiddenCount > 0 ? groups.slice(realHiddenCount) : groups),
    [groups, realHiddenCount],
  );
  const tailStart = useMemo(
    () => liveTailStart(visibleGroups, LIVE_TAIL_WEIGHT, LIVE_TAIL_MIN_GROUPS, LIVE_TAIL_MAX_GROUPS),
    [visibleGroups],
  );

  const showEarlier = useCallback(() => {
    anchorBeforePrepend();
    // Strict one-page stepping: only one RENDER_BUDGET per click — the UI is
    // the long-session perf lever, not the scroll. Without the cap a double-
    // click could stage the whole transcript.
    setRenderBudget((b) => Math.min(b + RENDER_BUDGET, groups.reduce((s, g) => s + (g.weight ?? 1), 0)));
  }, [anchorBeforePrepend, groups]);

  useLayoutEffect(() => {
    const el = containerRef?.current;
    if (el && restoreFromBottomRef.current != null) {
      el.scrollTop = el.scrollHeight - restoreFromBottomRef.current;
      restoreFromBottomRef.current = null;
    }
  }, [containerRef, renderBudget, groups.length]);

  // Publish minimal geometry for ChatNavArrow when needed (visible groups only).
  // Arrows already key on !isAtBottom; this just lets them jump to a user turn
  // within the rendered window. Hidden turns remain unreachable until expanded.
  const indexToGroupOffset = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    for (const g of visibleGroups) {
      map.set(g.id, acc);
      acc += 1; // one turn ≈ one layout block; jump centers via DOM id instead of offsets
    }
    return map;
  }, [visibleGroups]);
  void indexToGroupOffset;

  if (modelRef) {
    // Backward-compat: return no-op geometry until nav arrows migrate to DOM ids.
    modelRef.current = {
      getRowTop: () => undefined,
      getRowHeight: () => undefined,
    };
  }

  const callbacks = useMemo(
    () => ({
      agentAvatar,
      onApprove,
      onDeny,
      onClarifyResolved,
      onClarifyRespond,
      onRevertCheckpoint,
      onUnsendLastUser,
      onOpenFileChanges,
    }),
    [
      agentAvatar,
      onApprove,
      onDeny,
      onClarifyResolved,
      onClarifyRespond,
      onRevertCheckpoint,
      onUnsendLastUser,
      onOpenFileChanges,
    ],
  );

  // Turn groups -> row JSX. Memoized so isAtBottom flips don't rebuild rows.
  const turnRows = useMemo(() => {
    const out: React.JSX.Element[] = [];
    let cursorRole: string | undefined;
    let cursorReason: string | undefined;
    for (let gi = 0; gi < visibleGroups.length; gi++) {
      const g = visibleGroups[gi];
      const slice = g.indices.map((idx) => visibleMessages[idx]!);
      const { rows, lastRole, turnLastReasoningId } = buildRows(
        slice,
        g.indices[0],
        visibleMessages.length,
        lastUserBubbleIdx,
        cursorRole,
        cursorReason,
        isLoading,
        callbacks,
      );
      cursorRole = lastRole;
      cursorReason = turnLastReasoningId;
      const live = gi >= tailStart;
      void live;
      const key = g.id;
      const el = (
        <div
          key={key}
          data-turn-id={key}
          className={gi < tailStart ? "[contain-intrinsic-size:auto_37.5rem] [content-visibility:auto]" : undefined}
        >
          {rows}
        </div>
      );
      out.push(el);
    }
    return out;
  }, [visibleGroups, visibleMessages, lastUserBubbleIdx, isLoading, tailStart, callbacks, structuralSig]);

  void structuralSig;

  const olderAvailable = false; // fork has no separate store window; DOM paging is the window

  return (
    <>
      {(realHiddenCount > 0 || olderAvailable) && (
        <button
          type="button"
          className="chat-show-earlier"
          onClick={showEarlier}
        >
          Show earlier
        </button>
      )}
      {turnRows}
      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={toolProgress} agentAvatar={agentAvatar} />
      )}
      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
