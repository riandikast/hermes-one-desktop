import { useEffect, useRef } from "react";

interface OnFinishBannerProps {
  /** Session id of the terminal session to send input to. */
  sessionId: string | null;
  /** True while the banner is visible. */
  visible: boolean;
  /** Called when the user dismisses / acts on the banner. */
  onDismiss: () => void;
  /** Called when the user requests a re-run. */
  onRerun: () => void;
}

/**
 * Small overlay banner shown after an on-finish command completes.
 * Forwards keyboard shortcuts to the active terminal session:
 *   Enter / Y  → send "\n" (confirm / continue)
 *   N / Ctrl+C → send "\x03" (SIGINT / interrupt)
 *   R          → trigger re-run of the queue
 * Dismissed automatically on any of those keys, or by clicking outside.
 */
// @lat: [[chat-manual-tools#On-finish keyboard banner]]
export function OnFinishBanner({
  sessionId,
  visible,
  onDismiss,
  onRerun,
}: OnFinishBannerProps): React.JSX.Element | null {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;

    const handler = (e: KeyboardEvent): void => {
      const key = e.key;
      if (key === "Enter" || key === "y" || key === "Y") {
        e.preventDefault();
        if (sessionId) window.hermesAPI.terminalWrite({ id: sessionId, data: "\n" });
        onDismiss();
      } else if (key === "n" || key === "N" || (key === "c" && e.ctrlKey)) {
        e.preventDefault();
        if (sessionId) window.hermesAPI.terminalWrite({ id: sessionId, data: "\x03" });
        onDismiss();
      } else if (key === "r" || key === "R") {
        e.preventDefault();
        onDismiss();
        onRerun();
      } else if (key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, sessionId, onDismiss, onRerun]);

  if (!visible) return null;

  return (
    <>
      {/* Click-outside backdrop */}
      <div
        className="on-finish-banner-backdrop"
        aria-hidden
        onClick={onDismiss}
      />
      <div
        ref={bannerRef}
        className="on-finish-banner"
        role="status"
        aria-live="polite"
        aria-label="On-finish command completed"
      >
        <span className="on-finish-banner-label">On-finish done</span>
        <div className="on-finish-banner-actions">
          <button
            type="button"
            className="on-finish-banner-btn on-finish-banner-btn--confirm"
            title="Continue (Enter / Y)"
            onClick={() => {
              if (sessionId) window.hermesAPI.terminalWrite({ id: sessionId, data: "\n" });
              onDismiss();
            }}
          >
            <kbd>Enter</kbd> Continue
          </button>
          <button
            type="button"
            className="on-finish-banner-btn on-finish-banner-btn--interrupt"
            title="Interrupt (N / Ctrl+C)"
            onClick={() => {
              if (sessionId) window.hermesAPI.terminalWrite({ id: sessionId, data: "\x03" });
              onDismiss();
            }}
          >
            <kbd>N</kbd> Interrupt
          </button>
          <button
            type="button"
            className="on-finish-banner-btn on-finish-banner-btn--rerun"
            title="Re-run (R)"
            onClick={() => {
              onDismiss();
              onRerun();
            }}
          >
            <kbd>R</kbd> Re-run
          </button>
        </div>
      </div>
    </>
  );
}
