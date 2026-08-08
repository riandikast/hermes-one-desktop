import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

/**
 * Custom window controls for the Windows hidden frame. The native caption
 * buttons are gone (start.ts) — the renderer draws minimize/maximize/close
 * with lucide icons and drives the window over the window:* IPC surface
 * (preload electronAPI.windowControls).
 *
 * Renders nothing when the preload surface is absent (web preview), so the
 * layout never shows dead buttons.
 */
export function WindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const controls = window.electron?.windowControls;
    if (!controls) return;
    const unsubscribe = controls.onMaximizedChange((value) => {
      setMaximized(value);
    });
    controls.isMaximized().then(setMaximized).catch(() => {
      /* window state query failed — stay with the default */
    });
    return unsubscribe;
  }, []);

  const controls = window.electron?.windowControls;
  if (!controls) return null;

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        onClick={() => void controls.minimize()}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="window-control"
        onClick={() => void controls.maximize()}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <Copy size={12} /> : <Square size={11} />}
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        onClick={() => void controls.close()}
        title="Close"
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
