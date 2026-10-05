import { useEffect, useRef } from "react";
import { FolderOpen, Send } from "lucide-react";

/**
 * "Confirm before sending" dialog.
 *
 * The composer already gates a send behind a double-Enter (the first Enter arms
 * a pending send, the second dispatches it). That gate existed only as a thin
 * inline banner, which said nothing about WHERE the prompt was about to go —
 * the whole point of the confirmation is to catch a prompt being sent into the
 * wrong session/project.
 *
 * So the armed state now surfaces as a modal that names the target project, and
 * the keyboard contract is unchanged: Enter again sends, Escape cancels. The
 * dialog is deliberately NOT a focus trap — the user may keep typing in the
 * composer (editing the text cancels the arm, see ChatInput), so it never steals
 * focus.
 */

/** Last path segment of a project folder, for a compact title. */
export function projectLabel(folder: string): string {
  const parts = String(folder ?? "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : folder;
}

export function SendConfirmDialog({
  open,
  folders,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Active context folders. Empty/undefined = no project bound this session. */
  folders?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  // Enter-to-confirm is handled on the document so it works while focus stays in
  // the composer (the common case: the user just pressed Enter there).
  const confirmRef = useRef(onConfirm);
  const cancelRef = useRef(onCancel);
  confirmRef.current = onConfirm;
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      // Let Shift+Enter insert a newline in the composer rather than confirming.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        confirmRef.current();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
      }
    };
    // Capture phase: this must win over the composer's own Enter handler.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const list = (folders ?? []).filter((f) => String(f ?? "").trim());
  const project = list.length > 0 ? projectLabel(list[0]) : null;

  return (
    <div
      className="send-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm sending prompt"
      onClick={onCancel}
    >
      <div className="send-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="send-confirm-head">
          <Send size={14} aria-hidden />
          <span className="send-confirm-title">Send this prompt?</span>
        </div>

        <div className="send-confirm-project">
          {project ? (
            <>
              <span className="send-confirm-project-label">
                <FolderOpen size={13} aria-hidden />
                Project
              </span>
              <span className="send-confirm-project-name" title={list[0]}>
                {project}
              </span>
              {list.length > 1 && (
                <span className="send-confirm-project-more">
                  +{list.length - 1} more
                </span>
              )}
              {/* Full path, so a same-named folder in another location is
                  distinguishable — the exact mistake this gate prevents. */}
              <span className="send-confirm-project-path" title={list[0]}>
                {list[0]}
              </span>
            </>
          ) : (
            <span className="send-confirm-project-none">
              No project folder bound — this prompt goes to the current session.
            </span>
          )}
        </div>

        <div className="send-confirm-actions">
          <span className="send-confirm-hint">
            Press <kbd>Enter</kbd> to send, <kbd>Esc</kbd> to cancel
          </span>
          <div className="send-confirm-buttons">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onConfirm}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
