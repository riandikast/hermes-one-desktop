import { memo, useState, useCallback } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Copy, Check, Undo2, RotateCcw, Pin } from "lucide-react";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { OrbLoader } from "../../components/OrbLoader";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import { TypeAnimation } from "../../components/TypeAnimation";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens, cleanLeakedToolTags } from "./mediaUtils";
import { useReasoningGate } from "./useReasoningGate";
import type { ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

// The answer bubble does NOT use a typewriter. The accumulated/streamed
// response text appears instantly (gated behind the turn's thought, then
// faded in by the .chat-message `messageIn` entrance). Typing a long
// streamed answer either strobes in chunky frames or is still mid-typewriter
// when the next thought row lands below — which reads as a stalled response.
// Late deltas simply grow the text in place (streaming paste), no typewriter.

/**
 * Coerce any DB, stream, or IPC timestamp value to valid epoch milliseconds.
 * Handles seconds (< 1e12), ms, us (> 1e14), ns (> 1e17), and ISO strings.
 */
const MS_THRESHOLD = 1e12;
const US_THRESHOLD = 1e14;
const NS_THRESHOLD = 1e17;

function coerceToEpochMs(raw: unknown): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (raw < MS_THRESHOLD) return raw * 1000;
    if (raw < US_THRESHOLD) return raw;
    if (raw < NS_THRESHOLD) return Math.floor(raw / 1000);
    return Math.floor(raw / 1_000_000);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return coerceToEpochMs(num);
    }
    const parsed = new Date(trimmed).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

// Earliest valid chat timestamp: Jan 1 2020 (1577836800000 ms).
// Anything before 2020 (e.g. 0, 1 => Jan 1970 => "57 years ago") is bogus/dummy.
const MIN_VALID_EPOCH_MS = 1_577_836_800_000;

function isValidEpochMs(ms: number): boolean {
  return (
    Number.isFinite(ms) &&
    ms >= MIN_VALID_EPOCH_MS &&
    !isNaN(new Date(ms).getTime())
  );
}

/**
 * Relative "time ago" label for the hover-time element.
 */
function formatBubbleTime(ms: number): string | null {
  try {
    if (Date.now() - ms < 10_000 && Date.now() >= ms) return "just now";
    return formatDistanceToNowStrict(ms, { addSuffix: true });
  } catch {
    return null;
  }
}

/** Absolute timestamp for the tooltip and `<time dateTime>` value. */
function formatBubbleTimeAbsolute(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

/** Appearance of the agent whose turn a row belongs to, used to render its
 *  profile avatar while idle. Name drives the letter/logo + default colour. */
export interface AgentAvatarInfo {
  name: string;
  color?: string | null;
  avatar?: string | null;
}

/**
 * Agent avatar. While `active` (the turn is generating) it shows the animated
 * thinking-orb ([[loading-indicators]]) — the `solving` orb scaled to the
 * avatar footprint via `style` ([[OrbLoader]] snaps the design to the nearest
 * shipped preset); its ink follows the app theme. When `active` goes false it
 * swaps straight to the agent's profile avatar so idle turns are identified by
 * who produced them (no per-frame stop dance is needed — the canvas orb has no
 * freeze-mid-frame problem the way the old gif did). With no known agent (e.g.
 * the live typing indicator before any turn) the orb stays as the fallback.
 */
export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
  active = false,
  agent,
}: {
  size?: number;
  /** True only for the avatar of the turn currently being generated. */
  active?: boolean;
  /** The agent whose profile avatar shows once the turn is idle. When absent
   *  (e.g. the live typing indicator) the orb is used as the fallback. */
  agent?: AgentAvatarInfo;
}): React.JSX.Element {
  const showOrb = active || !agent;

  return (
    <div
      className={`chat-avatar chat-avatar-agent${
        showOrb ? " chat-avatar-orb" : ""
      }`}
    >
      {showOrb ? (
        <OrbLoader
          state="composing"
          size={64}
          invert
          style={{ width: size, height: size }}
        />
      ) : (
        <ProfileAvatar
          name={agent.name}
          color={agent.color}
          avatar={agent.avatar}
          size={size}
        />
      )}
    </div>
  );
});

/**
 * Empty box the size of an avatar. Rendered in place of the avatar on
 * continuation rows of a turn (the thinking/tool rows and answer bubble that
 * follow the first row) so one turn shows a single avatar while every row
 * stays aligned to the same content column.
 */
export const AvatarSpacer = memo(function AvatarSpacer(): React.JSX.Element {
  return <div className="chat-avatar" aria-hidden="true" />;
});

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  /** False on continuation rows of a turn — render a spacer instead of the
   *  avatar so the turn reads as one grouped block. Defaults to true. */
  showAvatar?: boolean;
  /** Appearance of the chatting agent, shown once the avatar goes idle. */
  agent?: AgentAvatarInfo;
  /** Fired when the user clicks the "revert to this checkpoint" button on a
   *  user message row. The desktop runs `/rollback` to restore the working
   *  directory snapshot taken before this turn — like AntiGravity's
   *  "revert to checkpoint" per-message button. */
  onRevertCheckpoint?: (msgId: string) => void;
  /** Fired when the user clicks the "unsend" button on the most recent user
   *  row. The desktop runs `/undo 1` (gateway-side truncation, no double
   *  token) and re-populates the input box so the user can edit+resend. */
  onUnsendLastUser?: (msgId: string, content: string) => void;
  /** True only for the most recent user bubble — restricts the unsend button
   *  to that row so it doesn't clutter older bubbles. */
  isLastUser?: boolean;
  onPinToggle?: (msgId: string, pinned: boolean) => void;
  /** Toggle pin state on a bubble (user or agent). */
  /** Id of the last reasoning row of THIS turn (or undefined when the turn
   *  has no thinking). The answer's reveal holds until that thought settles,
   *  so the response never leaks out while the thought is still typing. */
  waitForReasoningId?: string;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
  agent,
  onRevertCheckpoint,
  onUnsendLastUser,
  isLastUser = false,
  waitForReasoningId,
  onPinToggle,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // MessageRow is wrapped in memo() but still re-renders on any prop change
  // (e.g. isLoading toggling at the end of a stream), and `parseMediaTokens`
  // runs a full regex pipeline. Cache the result against the message content
  // so a long conversation doesn't reparse every row on every render.
  // Only agent bubbles need media parsing — user bubbles render content
  // verbatim — so this is gated on the role to skip the work entirely for
  // user rows. (Follow-up item from PR #303 review.)
  const bubbleContent = isChatBubbleMessage(msg)
    ? (msg as ChatBubbleMessage).content
    : null;

  // Answer reveal. Gated behind the turn's thought: the bubble stays hidden
  // (`waiting`) until the most recent preceding reasoning row has finished
  // typing ([[useReasoningGate]]), so the response can't leak out mid-thought
  // ("partial thought -> partial response"). When the gate opens the whole
  // accumulated answer fades in via the .chat-message `messageIn` entrance —
  // the answer is NOT typed (see the constants above for why). Deltas that
  // arrive after the gate open simply grow the text in place (streaming
  // paste), so a later thought row landing below never finds the response
  // mid-typewriter (which would read as a stalled response).
  const { waiting } = useReasoningGate({
    waitForReasoningId,
    hasContent: Boolean(bubbleContent),
    isLoading,
  });

  const transformCodeMarkers = useCallback((text: string): string => {
    // Match ##...## using explicit start/end markers instead of backreferences
    return text.replace(/(?:^|\s)##([\s\S]*?)##(?:\s|$)/g, (_match, body) => {
      const trimmed = body.trim();
      if (!trimmed) return _match;
      return '\n```\n' + trimmed + '\n```\n';
    });
  }, []);

  const renderStreamingContent = useCallback(
    (visible: string): React.ReactNode => {
      const visibleSegments = parseMediaTokens(cleanLeakedToolTags(visible));
      return visibleSegments.map((segment) =>
        segment.type === "text" ? (
          segment.value.trim() ? (
            <AgentMarkdown key={`t-${segment.start}`}>
              {segment.value}
            </AgentMarkdown>
          ) : null
        ) : (
          <MediaSegmentView
            key={`m-${segment.start}`}
            token={segment.token}
            raw={segment.raw}
            source={segment.source}
          />
        ),
      );
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (!bubbleContent) return;
    try {
      await window.hermesAPI.copyToClipboard(bubbleContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: clipboard write may fail in some environments
    }
  }, [bubbleContent]);

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? (
          <HermesAvatar active={isLoading && isLast} agent={agent} />
        ) : (
          <AvatarSpacer />
        )}
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !msg.error &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  const epochMs = coerceToEpochMs(msg.timestamp);
  const isTimeValid = isValidEpochMs(epochMs);
  const bubbleTime = isTimeValid ? formatBubbleTime(epochMs) : null;

  return (
    <div
      id={`chat-msg-${msg.id}`}
      className={`chat-message chat-message-${msg.role}${
        showAvatar ? "" : " chat-message--grouped"
      }${waiting ? " chat-message--hidden" : ""}`}
    >
      {/* User messages stand alone (right-aligned bubble, no avatar). Only the
          agent turn carries an avatar; its continuation rows get a spacer. */}
      {msg.role === "user" ? null : !showAvatar ? (
        <AvatarSpacer />
      ) : (
        <HermesAvatar active={isLoading && isLast} agent={agent} />
      )}
      <div
        className={`chat-bubble chat-bubble-${msg.role}${
          msg.error ? " chat-bubble-error" : ""
        }`}
      >
        {msg.content && !isLoading && !msg.isSlashLoader && (
          <div className="chat-bubble-actions">
            <button
              type="button"
              className="chat-bubble-copy"
              onClick={handleCopy}
              title={copied ? t("common.copied") : t("chat.copyMessage")}
              aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {onPinToggle && (msg.role === "user" || msg.role === "agent") && !msg.isSlashLoader && (
              <button
                type="button"
                className={`chat-bubble-copy${(msg as ChatBubbleMessage).pinned ? " chat-bubble-copy--active" : ""}`}
                onClick={() => onPinToggle(msg.id, !(msg as ChatBubbleMessage).pinned)}
                title={(msg as ChatBubbleMessage).pinned ? "Unpin" : "Pin to top"}
                aria-label={(msg as ChatBubbleMessage).pinned ? "Unpin" : "Pin to top"}
              >
                <Pin size={14} />
              </button>
            )}
            {msg.role === "user" && onRevertCheckpoint && (
              <button
                type="button"
                className="chat-bubble-copy"
                onClick={() => onRevertCheckpoint(msg.id)}
                title="Revert file changes to this checkpoint"
                aria-label="Revert to checkpoint"
              >
                <RotateCcw size={14} />
              </button>
            )}
            {msg.role === "user" && isLastUser && onUnsendLastUser && (
              <button
                type="button"
                className="chat-bubble-copy"
                onClick={() =>
                  onUnsendLastUser(
                    msg.id,
                    (msg as ChatBubbleMessage).content || "",
                  )
                }
                title="Unsend — edit and resend this message"
                aria-label="Unsend message"
              >
                <Undo2 size={14} />
              </button>
            )}
          </div>
        )}
        {hasAttachments && (
          <div className="chat-message-attachments">
            {msg.attachments!.map((att) => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {msg.isSlashLoader ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <OrbLoader state="working" size={20} aria-label="running-command" />
            <span>{msg.content}</span>
          </div>
        ) : (
          msg.content &&
          (msg.role === "agent" ? (
            waiting ? (
              // Hidden row waiting for the turn's thought to finish typing —
              // render a caret so the row has a stable mount while hidden by
              // .chat-message--hidden. When the gate opens the full text
              // fades in via .chat-message messageIn (no typewriter).
              <span className="type-animation-caret" aria-hidden="true">
                ▍
              </span>
            ) : (
              <TypeAnimation
                text={msg.content}
                // active=false: the answer is never typed. It always renders
                // its full text (gated + faded in above; deltas paste in).
                active={false}
                showCaret={false}
              >
                {renderStreamingContent}
              </TypeAnimation>
            )
          ) : (
            msg.content.trim() ? (
              <AgentMarkdown>{transformCodeMarkers(msg.content)}</AgentMarkdown>
            ) : null
          ))
        )}
      </div>
      {msg.error && (
        <div className="chat-error-message" role="alert">
          {msg.error}
        </div>
      )}
      {bubbleTime && isTimeValid && (
        <time
          className="chat-bubble-time"
          dateTime={new Date(epochMs).toISOString()}
          title={formatBubbleTimeAbsolute(epochMs)}
        >
          {bubbleTime}
        </time>
      )}
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});
