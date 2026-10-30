import { Children, useRef, useState } from "react";

/** Two bounded panes; pointer and keyboard resizing share the same percentage. */
export function SourceControlSplit({ children, label, initial = 40, collapsed = false, className = "" }: {
  children: React.ReactNode; label: string; initial?: number; collapsed?: boolean; className?: string;
}): React.JSX.Element {
  const [width, setWidth] = useState(initial);
  const host = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const panes = Children.toArray(children);
  const update = (value: number): void => setWidth(Math.max(20, Math.min(80, value)));
  return <div ref={host} className={`source-control-split ${className}`} style={{ gridTemplateColumns: collapsed ? "minmax(0, 1fr) 0px 0px" : `minmax(0, ${width}fr) 6px minmax(0, ${100 - width}fr)` }}>
    {panes[0]}
    <div className="source-control-split-handle" hidden={collapsed} role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(width)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        update(event.key === "Home" ? 20 : event.key === "End" ? 80 : width + (event.key === "ArrowLeft" ? -2 : 2));
      }}
      onPointerDown={(event) => { if (event.button !== 0) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        const rect = host.current?.getBoundingClientRect();
        if (dragging.current && rect && rect.width > 0) update((event.clientX - rect.left) / rect.width * 100);
      }}
      onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }} />
    {panes[1]}
  </div>;
}
