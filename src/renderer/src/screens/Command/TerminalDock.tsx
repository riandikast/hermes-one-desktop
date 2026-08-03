import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plus, X } from "../../assets/icons";

export interface TerminalDockHandle {
  attachSession(id: string, title: string): void;
}

interface SessionState {
  id: string;
  title: string;
  dead: boolean;
}

interface DockSession {
  state: SessionState;
  term: Terminal;
  fit: FitAddon;
  /** Own div this terminal was opened into — kept alive for the session's
   *  life; tab switches toggle visibility, never dispose. */
  pane: HTMLDivElement;
  cleanup?: () => void;
}

/**
 * Tabbed integrated terminal dock (VS Code style). One xterm instance per
 * session; output streams from the main process via `terminal:data`; input
 * goes back via `terminal:write`. Sessions keep running while the dock is
 * mounted (i.e. while the Commands view is open — panes stay mounted).
 */
export const TerminalDock = forwardRef<
  TerminalDockHandle,
  {
    onNewSession: () => void;
    dockHeight: number;
    onResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
    onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onResizeEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
  }
>(function TerminalDock(
  { onNewSession, dockHeight, onResizeStart, onResizeMove, onResizeEnd },
  ref,
): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<Map<string, DockSession>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const createXterm = useCallback((id: string): DockSession => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      theme: {
        background: "#101014",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const pane = document.createElement("div");
    pane.className = "terminal-dock-pane";
    return { state: { id, title: "Terminal", dead: false }, term, fit, pane };
  }, []);

  const registerDataListeners = useCallback((id: string): (() => void) => {
    const offData = window.hermesAPI.onTerminalData(({ id: sid, data }) => {
      if (sid !== id) return;
      sessionsRef.current.get(sid)?.term.write(data);
    });
    const offExit = window.hermesAPI.onTerminalExit(({ id: sid }) => {
      if (sid !== id) return;
      const dock = sessionsRef.current.get(sid);
      if (dock) {
        dock.term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, dead: true } : s)),
        );
      }
    });
    return () => {
      offData();
      offExit();
    };
  }, []);

  const attachSession = useCallback(
    (id: string, title: string): void => {
      const existing = sessionsRef.current.get(id);
      if (existing) {
        setActiveId(id);
        return;
      }
      const dock = createXterm(id);
      dock.state.title = title;
      containerRef.current?.appendChild(dock.pane);
      dock.term.open(dock.pane);
      sessionsRef.current.set(id, dock);
      const cleanup = registerDataListeners(id);
      dock.cleanup = cleanup;
      const dataSub = dock.term.onData((data) => {
        window.hermesAPI.terminalWrite({ id, data });
      });
      const prevCleanup = cleanup;
      dock.cleanup = () => {
        prevCleanup();
        dataSub.dispose();
      };
      setSessions((prev) => [...prev, dock.state]);
      setActiveId(id);
    },
    [createXterm, registerDataListeners],
  );

  useImperativeHandle(ref, () => ({ attachSession }), [attachSession]);

  // Tab switch: toggle pane visibility, fit the newly active terminal, keep
  // the pty in sync with the dock size. Terminals are NEVER disposed here —
  // disposing is permanent in xterm and would blank the tab forever.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    for (const [sid, dock] of sessionsRef.current) {
      dock.pane.style.display = sid === activeId ? "block" : "none";
    }
    const active = activeId ? sessionsRef.current.get(activeId) : null;
    if (!active) return;
    // The pane is now visible; refit so the pty matches the real geometry.
    const raf = requestAnimationFrame(() => {
      active.fit.fit();
      window.hermesAPI.terminalResize({
        id: active.state.id,
        cols: active.term.cols,
        rows: active.term.rows,
      });
    });
    const ro = new ResizeObserver(() => {
      const cur = activeId ? sessionsRef.current.get(activeId) : null;
      if (!cur) return;
      cur.fit.fit();
      window.hermesAPI.terminalResize({
        id: cur.state.id,
        cols: cur.term.cols,
        rows: cur.term.rows,
      });
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [activeId]);

  // Free a session when its tab is closed.
  const closeSession = useCallback(
    (id: string): void => {
      const dock = sessionsRef.current.get(id);
      if (dock) {
        window.hermesAPI.terminalKill(id);
        sessionsRef.current.delete(id);
        dock.cleanup?.();
        dock.pane.remove();
        dock.term.dispose();
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setActiveId((prev) => {
        if (prev !== id) return prev;
        const remaining = sessions.filter((s) => s.id !== id);
        return remaining.length > 0 ? remaining[0].id : null;
      });
    },
    [sessions],
  );

  return (
    <div className="terminal-dock" style={{ height: dockHeight }}>
      <div
        className="terminal-dock-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        aria-label="Resize terminal"
        title="Drag to resize"
      />
      <div className="terminal-dock-tabs" role="tablist">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="tab"
            aria-selected={s.id === activeId}
            className={`terminal-dock-tab ${s.id === activeId ? "active" : ""} ${s.dead ? "dead" : ""}`}
            onClick={() => setActiveId(s.id)}
            title={s.title}
          >
            <span className="terminal-dock-tab-title">{s.title}</span>
            <button
              type="button"
              className="terminal-dock-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
              aria-label="Close terminal"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="terminal-dock-tab-new"
          onClick={onNewSession}
          aria-label="New terminal session"
          title="New terminal session"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="terminal-dock-body" ref={containerRef} />
    </div>
  );
});
