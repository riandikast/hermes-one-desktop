import { memo, useEffect, useRef, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { ClarifyMessage } from "./types";

/**
 * Sentinel answer for "skip — let Hermes decide". Mirrors the gateway's
 * autonomous-proceed convention: an empty answer tells the agent to choose a
 * reasonable default rather than block.
 */
const SKIP_ANSWER = "";

/**
 * A skip that the gateway never acknowledges leaves the turn alive forever:
 * the main process forwards `clarify.respond` with a 5-MINUTE timeout, and the
 * renderer deliberately keeps `isLoading` true while a card is pending. Users
 * saw "skip — Hermes decided" hang with a spinner and no way forward. After
 * this long with no resolution signal we treat the skip as failed and end the
 * turn visibly instead.
 */
const SKIP_RESOLVE_TIMEOUT_MS = 30_000;

interface ClarifyCardProps {
  msg: ClarifyMessage;
  /** Mark the card resolved in parent state once the user answers/skips. */
  onResolved: (requestId: string, answer: string, questionId?: string) => void;
  /** Optional answer transport. Defaults to the legacy `respondClarify` IPC
   *  (main-process gateway). The dashboard transport passes its own
   *  `respondClarify` here so the answer flows over the live WebSocket. */
  onRespond?: (
    requestId: string,
    answer: string,
    questionId?: string,
  ) => Promise<boolean>;
  /**
   * Called when a submitted answer never resolves (see
   * SKIP_RESOLVE_TIMEOUT_MS). Lets the parent clear the loading state and
   * surface a retry instead of spinning forever.
   */
  onStuck?: (requestId: string, answer: string) => void;
}

/**
 * Inline card for a mid-turn `clarify.request`. Renders the agent's choices as
 * quick-pick buttons (when offered) AND always an open textarea, so a custom
 * answer is possible even when choices exist — matching other agent harnesses.
 * Also offers an auto-choose skip and reports an unanswered submit.
 */
export const ClarifyCard = memo(function ClarifyCard({
  msg,
  onResolved,
  onRespond,
  onStuck,
}: ClarifyCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  // Set once the answer was ACCEPTED; the stuck timer only fires before this.
  const acceptedRef = useRef(false);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolved = !!msg.resolved;

  // Flash the taskbar while this card is waiting on the user, and stop the
  // moment it resolves (or the card unmounts). A no-op when the window is
  // already focused.
  useEffect(() => {
    if (resolved) return;
    void window.hermesAPI?.setWindowAttention?.(true);
    return () => {
      void window.hermesAPI?.setWindowAttention?.(false);
    };
  }, [resolved]);

  useEffect(
    () => () => {
      if (stuckTimerRef.current !== null) clearTimeout(stuckTimerRef.current);
    },
    [],
  );

  const submit = async (answer: string): Promise<void> => {
    if (resolved || submitting) return;
    setSubmitting(true);
    setError(false);
    // Arm the "never resolved" watchdog for this submission. Cleared when the
    // transport confirms delivery.
    if (stuckTimerRef.current !== null) clearTimeout(stuckTimerRef.current);
    stuckTimerRef.current = setTimeout(() => {
      stuckTimerRef.current = null;
      if (acceptedRef.current) return;
      setSubmitting(false);
      onStuck?.(msg.requestId, answer);
    }, SKIP_RESOLVE_TIMEOUT_MS);

    try {
      // A batch question must echo its `qid` back as `question_id` so the
      // gateway locks only that question. Passed as a third argument ONLY when
      // present, so the single-question (and legacy IPC) call keeps its exact
      // historical 2-argument shape.
      const ok = onRespond
        ? msg.questionId
          ? await onRespond(msg.requestId, answer, msg.questionId)
          : await onRespond(msg.requestId, answer)
        : await window.hermesAPI.respondClarify(msg.requestId, answer);
      // The IPC handler returns false when no pending request matched (e.g. the
      // turn already ended). Only flip the card to resolved on a confirmed
      // delivery; otherwise surface an error and let the user retry.
      if (ok === false) {
        if (stuckTimerRef.current !== null) {
          clearTimeout(stuckTimerRef.current);
          stuckTimerRef.current = null;
        }
        setError(true);
        return;
      }
      acceptedRef.current = true;
      if (stuckTimerRef.current !== null) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
      if (msg.questionId) onResolved(msg.requestId, answer, msg.questionId);
      else onResolved(msg.requestId, answer);
    } catch {
      if (stuckTimerRef.current !== null) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (resolved) {
    return (
      <div className="chat-clarify chat-clarify--resolved">
        <div className="chat-clarify-question">{msg.question}</div>
        <div className="chat-clarify-answer">
          {msg.answer && msg.answer.trim()
            ? msg.answer
            : t("chat.clarify.skipped")}
        </div>
      </div>
    );
  }

  const hasChoices = msg.choices.length > 0;

  return (
    <div className="chat-clarify">
      <div className="chat-clarify-question">
        {msg.question || t("chat.clarify.defaultQuestion")}
      </div>

      {hasChoices && (
        <div className="chat-clarify-choices">
          {msg.choices.map((choice, i) => (
            <button
              key={`${msg.requestId}-${i}`}
              className="chat-clarify-choice"
              disabled={submitting}
              onClick={() => void submit(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {/* Always available, even with choices: the agent's list is a shortcut,
          not a constraint. Label it only when it is an alternative. */}
      <div className="chat-clarify-open">
        {hasChoices && (
          <div className="chat-clarify-or">{t("chat.clarify.orOwn")}</div>
        )}
        <textarea
          className="chat-clarify-textarea"
          rows={hasChoices ? 2 : 3}
          value={text}
          placeholder={
            hasChoices
              ? t("chat.clarify.placeholderOwn")
              : t("chat.clarify.placeholder")
          }
          disabled={submitting}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              void submit(text);
            }
          }}
        />
        <button
          className="chat-clarify-send"
          disabled={submitting || !text.trim()}
          onClick={() => void submit(text)}
        >
          {t("chat.clarify.send")}
        </button>
      </div>

      <button
        className="chat-clarify-skip"
        disabled={submitting}
        onClick={() => void submit(SKIP_ANSWER)}
      >
        {t("chat.clarify.skip")}
      </button>

      {error && (
        <div className="chat-clarify-error" role="alert">
          {t("chat.clarify.error")}
        </div>
      )}
    </div>
  );
});
