import { useEffect, useState } from "react";

/**
 * Custom window controls for the Windows hidden frame. The native caption
 * buttons are gone (start.ts) — the renderer draws minimize/maximize/close and
 * drives the window over the window:* IPC surface (preload
 * electronAPI.windowControls).
 *
 * Glyphs mirror the official desktop's native Windows caption icons (Segoe
 * MDL2 10px geometry): thin line, square outline, diagonal cross, overlapping
 * squares for restore.
 *
 * Renders nothing when the preload surface is absent (web preview), so the
 * layout never shows dead buttons.
 */
function MinimizeGlyph(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function RestoreGlyph(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect
        x="0.5"
        y="2.5"
        width="7"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M2.5 0.5 L9.5 0.5 L9.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

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
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        onClick={() => void controls.maximize()}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        onClick={() => void controls.close()}
        title="Close"
        aria-label="Close"
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
