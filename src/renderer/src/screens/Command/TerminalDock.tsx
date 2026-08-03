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
  { onNewSession: () => void }
>(function TerminalDock({ onNewSession }, ref): React.JSX.Element {
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
    return { state: { id, title: "Terminal", dead: false }, term, fit };
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
      sessionsRef.current.set(id, dock);
      const cleanup = registerDataListeners(id);
      dock.cleanup = cleanup;
      setSessions((prev) => [...prev, dock.state]);
      setActiveId(id);
    },
    [createXterm, registerDataListeners],
  );

  useImperativeHandle(ref, () => ({ attachSession }), [attachSession]);

  // Mount the active terminal into the container + fit.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = activeId ? sessionsRef.current.get(activeId) : null;
    if (!active) return;
    active.term.open(container);
    active.fit.fit();
    // Resize observer keeps the pty in sync with the dock size.
    const ro = new ResizeObserver(() => {
      active.fit.fit();
      window.hermesAPI.terminalResize({
        id: active.state.id,
        cols: active.term.cols,
        rows: active.term.rows,
      });
    });
    ro.observe(container);
    const dataSub = active.term.onData((data) => {
      window.hermesAPI.terminalWrite({ id: active.state.id, data });
    });
    return () => {
      dataSub.dispose();
      ro.disconnect();
      active.term.dispose();
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
    <div className="terminal-dock">
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
