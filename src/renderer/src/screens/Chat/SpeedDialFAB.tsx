import { useCallback, useEffect, useRef, useState } from "react";
import { Grid2x2 } from "lucide-react";

interface SpeedDialItem {
  key: string;
  element: React.ReactNode;
}

interface SpeedDialFABProps {
  /** Individual tool icon buttons to reveal in the expanded stack. */
  items: SpeedDialItem[];
}

/**
 * Speed-dial FAB that wraps the floating control rail.
 * One visible button (grid icon); click expands all tool icons in a vertical
 * stack with CSS animation. Click outside or click FAB again to collapse.
 * Keyboard: Escape closes. Focus trapping is intentionally omitted — the
 * underlying buttons already handle their own accessibility.
 *
 * ponytail: radial fan layout; add when more than 7 items are needed.
 */
// @lat: [[chat-manual-tools#Speed-dial FAB]]
export function SpeedDialFAB({ items }: SpeedDialFABProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!fabRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  return (
    <div ref={fabRef} className={`speed-dial${open ? " speed-dial--open" : ""}`}>
      {/* Expanded items — rendered first so they sit BELOW the FAB in z-order. */}
      <div className="speed-dial-items" aria-hidden={!open}>
        {items.map(({ key, element }, i) => (
          <div
            key={key}
            className="speed-dial-item"
            style={{ "--item-index": i } as React.CSSProperties}
            onClick={close}
          >
            {element}
          </div>
        ))}
      </div>

      {/* The FAB trigger button. */}
      <button
        type="button"
        className="speed-dial-fab chat-display-controls-trigger"
        aria-expanded={open}
        aria-label={open ? "Collapse tools" : "Expand tools"}
        title={open ? "Collapse" : "Tools"}
        onClick={toggle}
      >
        <Grid2x2
          size={16}
          className={`speed-dial-icon${open ? " speed-dial-icon--open" : ""}`}
        />
      </button>
    </div>
  );
}
