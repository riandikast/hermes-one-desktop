import { useEffect, useRef, type ReactNode } from "react";
import { X } from "../../assets/icons";

/**
 * A floating dialog that hosts the On-Finish terminal.
 *
 * Deliberately NOT unmounted when closed. xterm instances are permanent once
 * created (a disposed terminal cannot be re-shown), so the children stay
 * mounted and are hidden instead — see the `hidden` prop pass-through in
 * Chat.tsx. Closing therefore preserves live sessions and their scrollback,
 * which is the whole point of moving the terminal off the input footer.
 *
 * Rendered as a real dialog: Escape closes, the backdrop closes, and focus is
 * moved into the panel so the terminal receives keystrokes immediately.
 */
export function TerminalDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  return (
    <div
      className={`terminal-dialog-overlay${open ? " is-open" : ""}`}
      // Visibility is driven by a class, never by unmounting: the terminal
      // inside must survive being closed.
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="terminal-dialog"
        role="dialog"
        aria-label={title}
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="terminal-dialog-head">
          <span className="terminal-dialog-title">{title}</span>
          <button
            type="button"
            className="terminal-dialog-close"
            onClick={onClose}
            aria-label="Close terminal"
            title="Close terminal"
          >
            <X size={14} />
          </button>
        </div>
        <div className="terminal-dialog-body">{children}</div>
      </div>
    </div>
  );
}
