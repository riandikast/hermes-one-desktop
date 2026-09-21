import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
 * DRAGGABLE by its header: the panel starts centered, and dragging offsets it
 * from there so it can be parked out of the way over long output.
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
  // Offset from the centered position, in px. Kept separate from the layout so
  // the panel stays centered by default and dragging is a pure translation.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // True while dragging: suppresses the transition (which would otherwise lag
  // every mousemove) and forces the grabbing cursor. This MUST be state, not
  // read from the ref during render — a ref change does not re-render.
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Ignore drags that begin on the close button.
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const nextX = drag.originX + (e.clientX - drag.startX);
    const nextY = drag.originY + (e.clientY - drag.startY);

    // Clamp so the panel can never be dragged fully off screen. Measure the
    // real rect rather than assuming the CSS size.
    const rect = panelRef.current?.getBoundingClientRect();
    const maxX = rect ? Math.max(0, (window.innerWidth - rect.width) / 2) : 0;
    const maxY = rect ? Math.max(0, (window.innerHeight - rect.height) / 2) : 0;
    setOffset({
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    });
  };

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Recentre when reopened from a different context: a panel left half
  // off-screen from a previous session is worse than losing the position.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setOffset({ x: 0, y: 0 });
  }

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
        className={`terminal-dialog${dragging ? " is-dragging" : ""}`}
        role="dialog"
        aria-label={title}
        aria-modal="false"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="terminal-dialog-head"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Double-click the header to snap back to center.
          onDoubleClick={() => setOffset({ x: 0, y: 0 })}
          title="Drag to move"
        >
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

