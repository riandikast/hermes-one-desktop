import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TabMenuAction {
  /** Menu label. */
  label: string;
  onSelect: () => void;
  /** Rendered greyed and unclickable when false. */
  enabled?: boolean;
}

/**
 * A right-click menu anchored at a point.
 *
 * A PORTAL to document.body, like `.active-session-context-menu` on the session
 * tab strip: the browser panel is a dialog with `overflow: hidden`, so an
 * in-place menu would be clipped at its edge. The portal also escapes the
 * dialog's stacking context, and `z-index` above even the splash screen is
 * required because Chromium renders `<webview>` in its own layer above the
 * page's DOM — a menu inside that stacking context can be covered by the guest.
 */
export function TabContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: readonly TabMenuAction[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp inside the viewport AFTER measuring, so a menu opened near the right
  // or bottom edge is nudged back in rather than rendering off-screen where its
  // items cannot be reached. useLayoutEffect so the correction happens before
  // paint (no visible jump).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [x, y]);

  // Dismiss on outside click, Escape, and any scroll/resize (a fixed menu would
  // be left pointing at the wrong place). Capture phase for Escape so it wins
  // over the dialog's own Escape-to-close handler.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".web-preview-tab-menu")) onClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onReflow = (): void => onClose();
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("blur", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("blur", onReflow);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="web-preview-tab-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      role="menu"
      aria-label="Tab actions"
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          className="web-preview-tab-menu-item"
          disabled={action.enabled === false}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
