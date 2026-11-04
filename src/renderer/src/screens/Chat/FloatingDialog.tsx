import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { X } from "../../assets/icons";

/**
 * A floating, draggable dialog panel.
 *
 * Deliberately NOT unmounted when closed for panels whose contents are
 * expensive or stateful to recreate (the terminal: xterm instances are
 * permanent once created, so its children stay mounted and are hidden instead —
 * closing preserves live sessions and their scrollback).
 *
 * Outside clicks never dismiss working panels. Close explicitly or use Escape.
 * A captured pointer on the corner handle resizes without losing webview input.
 *
 * DRAGGABLE by its header: the panel starts centered, and dragging offsets it
 * from there so it can be parked out of the way.
 */
export function FloatingDialog({
  open,
  onClose,
  title,
  children,
  size = "terminal",
  keepMounted = false,
  onNewSession,
  placement = "dialog",
  placementDocked = false,
  onTogglePlacement,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Size preset. `terminal` is the wide/short working size; `wide` is for
   * content that wants more height (web preview, file tree).
   */
  size?: "terminal" | "wide" | "full";
  /**
   * When true the children are hidden rather than unmounted while closed.
   * Required for anything that cannot be recreated cheaply (a live terminal).
   */
  keepMounted?: boolean;
  /** Terminal-only shortcut, captured before xterm consumes the key. */
  onNewSession?: () => void;
  /** Keep stateful contents mounted while presenting them as a right-side panel. */
  placement?: "dialog" | "sidebar";
  /** Whether the sidebar placement is active, for the header toggle state. */
  placementDocked?: boolean;
  /** Renders a header toggle that switches between floating and docked. */
  onTogglePlacement?: () => void;
  /** Extra classes on the panel, for a caller-specific skin (e.g. the
   *  Material-styled last-prompt reader) without restyling every dialog. */
  className?: string;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Offset from the centered position, in px. Kept separate from the layout so
  // the panel stays centered by default and dragging is a pure translation.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  const viewportRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  type ResizeEdge = "left" | "right";
  const resizeRef = useRef<{
    pointerId: number; x: number; y: number;
    width: number; height: number; left: number; top: number;
    offsetX: number; offsetY: number;
    edge: ResizeEdge;
  } | null>(null);

  const resize = (width: number, height: number, origin: NonNullable<typeof resizeRef.current>, edge: ResizeEdge): void => {
    // Match the left navigation sidebar's default width (Layout: 237px).
    const availableWidth = edge === "left"
      // Anchor the right edge: the panel may grow until its left edge reaches 24px.
      ? origin.left + origin.width - 24
      : window.innerWidth - Math.max(24, origin.left) - 24;
    const nextWidth = Math.min(Math.max(237, width), Math.max(237, availableWidth));
    const nextHeight = Math.min(Math.max(200, height), Math.max(0, window.innerHeight - Math.max(24, origin.top) - 24));
    setDimensions({ width: nextWidth, height: nextHeight });
    // CSS centers the panel. The right handle keeps the top-left stationary;
    // the left handle keeps the top-right stationary (the centre moves half
    // the width delta, with the opposite sign).
    const widthDelta = nextWidth - origin.width;
    setOffset({
      x: origin.offsetX + (edge === "left" ? -widthDelta : widthDelta) / 2,
      y: origin.offsetY + (nextHeight - origin.height) / 2,
    });
  };
  const resizeOrigin = (): NonNullable<typeof resizeRef.current> | null => {
    const rect = panelRef.current?.getBoundingClientRect();
    return rect ? { pointerId: 0, x: 0, y: 0, width: rect.width, height: rect.height,
      left: rect.left, top: rect.top, offsetX: offset.x, offsetY: offset.y, edge: "right" } : null;
  };
  const endResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
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

  // Keep a manually placed window where the user left it across close/open,
  // but pull a stale position back inside the viewport so it cannot reopen
  // half off-screen.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        const maxX = Math.max(0, (window.innerWidth - rect.width) / 2);
        const maxY = Math.max(0, (window.innerHeight - rect.height) / 2);
        setOffset((current) => ({
          x: Math.max(-maxX, Math.min(maxX, current.x)),
          y: Math.max(-maxY, Math.min(maxY, current.y)),
        }));
      }
    }
  }

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (placement !== "dialog") return;
    const keepVisible = (): void => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Preserve the window's on-screen left/top as the viewport changes: the
      // CSS-centred layout would otherwise slide it around. Clamp to the new
      // viewport only when the panel would fall outside it.
      const previous = viewportRef.current;
      const desiredLeft =
        (previous.w - rect.width) / 2 + offsetRef.current.x;
      const desiredTop =
        (previous.h - rect.height) / 2 + offsetRef.current.y;
      const left = Math.max(
        0,
        Math.min(desiredLeft, Math.max(0, window.innerWidth - rect.width)),
      );
      const top = Math.max(
        0,
        Math.min(desiredTop, Math.max(0, window.innerHeight - rect.height)),
      );
      viewportRef.current = {
        w: window.innerWidth,
        h: window.innerHeight,
      };
      setOffset({
        x: left - (window.innerWidth - rect.width) / 2,
        y: top - (window.innerHeight - rect.height) / 2,
      });
    };
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, [placement]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (onNewSession && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) onNewSession();
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, onNewSession]);

  const onResizePointerDown = (
    edge: ResizeEdge,
  ): ((event: React.PointerEvent<HTMLButtonElement>) => void) => (event) => {
    if (event.button !== 0) return;
    const origin = resizeOrigin();
    if (!origin) return;
    event.preventDefault();
    resizeRef.current = {
      ...origin,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      edge,
    };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onResizePointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const origin = resizeRef.current;
    if (origin?.pointerId !== event.pointerId) return;
    const dx = event.clientX - origin.x;
    resize(
      origin.edge === "left" ? origin.width - dx : origin.width + dx,
      origin.height + event.clientY - origin.y,
      origin,
      origin.edge,
    );
  };

  const onResizeKeyDown = (
    edge: ResizeEdge,
  ): ((event: React.KeyboardEvent<HTMLButtonElement>) => void) => (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = resizeOrigin();
    if (!origin) return;
    const step = event.shiftKey ? 64 : 16;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    resize(
      origin.width + (edge === "left" ? -dx : dx),
      origin.height + dy,
      { ...origin, edge },
      edge,
    );
  };

  return (
    <div
      className={`terminal-dialog-overlay${open ? " is-open" : ""}${placement === "sidebar" ? " is-sidebar" : ""}`}
      // Visibility is driven by a class, never by unmounting: the terminal
      // inside must survive being closed.
      aria-hidden={!open}
    >
      <div
        ref={panelRef}
        className={`terminal-dialog terminal-dialog--${size}${placement === "sidebar" ? " terminal-dialog--sidebar" : ""}${
          dragging ? " is-dragging" : ""
        }${resizing ? " is-resizing" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-label={title}
        aria-modal="false"
        style={
          placement === "sidebar"
            ? undefined
            : { ...dimensions, transform: `translate(${offset.x}px, ${offset.y}px)` }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="terminal-dialog-head"
          onPointerDown={
            placement === "dialog" ? onHeaderPointerDown : undefined
          }
          onPointerMove={
            placement === "dialog" ? onHeaderPointerMove : undefined
          }
          onPointerUp={placement === "dialog" ? endDrag : undefined}
          onPointerCancel={placement === "dialog" ? endDrag : undefined}
          // Double-click the header to snap back to center.
          onDoubleClick={
            placement === "dialog" ? () => setOffset({ x: 0, y: 0 }) : undefined
          }
          title={placement === "dialog" ? "Drag to move" : undefined}
        >
          <span className="terminal-dialog-title">{title}</span>
          {onTogglePlacement && (
            <button
              type="button"
              className={`terminal-dialog-close terminal-dialog-dock${
                placementDocked ? " is-active" : ""
              }`}
              onClick={onTogglePlacement}
              aria-pressed={placementDocked}
              aria-label={
                placementDocked
                  ? `Float ${title} in a window`
                  : `Attach ${title} to this chat`
              }
              title={
                placementDocked
                  ? "Detach to a floating window"
                  : "Attach to this chat"
              }
            >
              {placementDocked ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRight size={14} />
              )}
            </button>
          )}
          <button
            type="button"
            className="terminal-dialog-close"
            onClick={onClose}
            aria-label={`Close ${title}`}
            title={`Close ${title}`}
          >
            <X size={14} />
          </button>
        </div>
        <div className="terminal-dialog-body" hidden={keepMounted && !open}>
          {children}
        </div>
        {placement === "dialog" && (
          <>
            <button
              type="button"
              className="terminal-dialog-resize terminal-dialog-resize--left"
              aria-label={`Resize ${title} from the left`}
              title="Drag the left edge to resize; arrow keys resize, Shift for larger steps"
              onPointerDown={onResizePointerDown("left")}
              onPointerMove={onResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onLostPointerCapture={endResize}
              onKeyDown={onResizeKeyDown("left")}
            />
            <button
              type="button"
              className="terminal-dialog-resize"
              aria-label={`Resize ${title}`}
              title="Drag to resize; arrow keys resize, Shift for larger steps"
              onPointerDown={onResizePointerDown("right")}
              onPointerMove={onResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onLostPointerCapture={endResize}
              onKeyDown={onResizeKeyDown("right")}
            />
          </>
        )}

      </div>
    </div>
  );
}
