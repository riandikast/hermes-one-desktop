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
import {
  applyCompletion,
  buildInsertion,
  matchDirectories,
  parseCompletionContext,
  replacementKeystrokes,
  resolveListingDir,
  type DirEntry,
} from "./terminalComplete";

export interface TerminalDockHandle {
  /**
   * Attach a session to the dock. `cwd` is the directory the pty was created
   * in; it is only used to resolve relative paths for `cd` completion. Omit it
   * and relative fragments resolve against the process cwd, which is what the
   * shell does too.
   */
  attachSession(id: string, title: string, cwd?: string): void;
  /**
   * Re-fit the active terminal to its container and push the new geometry to
   * the pty. Required after the dock has been hidden: xterm measures zero/tiny
   * dimensions while `display: none`, so a stale geometry would wrap output at
   * the wrong column count until the next resize.
   */
  refit(): void;
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
    /**
     * Fixed dock height in px. OMIT to let CSS size the dock instead — the
     * On-Finish dialog does this so the panel controls the terminal's size
     * rather than an inline height overriding the dialog's layout.
     */
    dockHeight?: number;
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
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest tab visible: when a session is added, scroll the tab
  // strip to the end so the fresh tab is always in view.
  useEffect(() => {
    const el = tabsScrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [sessions.length]);

  // Plain wheel over the tab strip scrolls it horizontally (browser-tab
  // style). Shift+wheel is reserved for UI zoom (useUiZoom) — never touch it.
  const onTabsWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (e.shiftKey) return;
    const el = tabsScrollRef.current;
    if (!el) return;
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (!delta) return;
    el.scrollLeft += delta;
    e.preventDefault();
  };

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
    (id: string, title: string, cwd?: string): void => {
      if (typeof cwd === "string" && cwd) cwdRef.current.set(id, cwd);
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
        // Track the current line so `cd` completion knows what is typed: the
        // shell owns the real buffer, so we mirror it from the keystrokes we
        // forward. See handleTerminalInput.
        onInputRef.current(id, data);
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

  // ── `cd` path completion ────────────────────────────────────────────────
  // The shell owns the input buffer, so the line being typed is mirrored here
  // from forwarded keystrokes. Tab opens a dropdown above the terminal.
  const [completion, setCompletion] = useState<{
    fragment: string;
    line: string;
    entries: DirEntry[];
    index: number;
  } | null>(null);
  // Per-session line buffer. A ref: it changes on every keystroke and must not
  // re-render the dock.
  const linesRef = useRef<Map<string, string>>(new Map());
  const cwdRef = useRef<Map<string, string>>(new Map());

  const closeCompletion = useCallback((): void => setCompletion(null), []);

  /** Apply the chosen entry: replace the shell line and refocus the terminal. */
  const commitCompletion = useCallback(
    (entry: DirEntry): void => {
      const state = completion;
      const id = activeIdRef.current;
      if (!state || !id) return;
      const ctx = parseCompletionContext(state.line);
      if (!ctx) return closeCompletion();

      const insertion = buildInsertion(ctx.dirPart, entry.name);
      const nextLine = applyCompletion(state.line, insertion);
      linesRef.current.set(id, nextLine);
      // Ctrl-U then the rebuilt line: the shell owns the buffer, so replacing
      // the fragment means clearing the line and retyping it.
      window.hermesAPI.terminalWrite({
        id,
        data: replacementKeystrokes(nextLine),
      });
      setCompletion(null);
      sessionsRef.current.get(id)?.term.focus();
    },
    [completion, closeCompletion],
  );

  /** Load directory matches for the fragment currently under the caret. */
  const openCompletion = useCallback((id: string): void => {
    const line = linesRef.current.get(id) ?? "";
    const ctx = parseCompletionContext(line);
    if (!ctx) return setCompletion(null);

    const cwd = cwdRef.current.get(id) ?? "";
    const dir = resolveListingDir(cwd, ctx.dirPart);
    void window.hermesAPI
      .readDirectory(dir)
      .then((entries) => {
        if (!entries) return; // remote mode returns null
        const matches = matchDirectories(entries, ctx.namePrefix);
        if (matches.length === 0) return setCompletion(null);
        setCompletion({
          fragment: ctx.fragment,
          line,
          entries: matches,
          index: 0,
        });
      })
      .catch(() => setCompletion(null));
  }, []);

  const onInputRef = useRef<(id: string, data: string) => void>(() => undefined);

  const handleTerminalInput = useCallback(
    (id: string, data: string): void => {
      // Tab with no dropdown open: offer completions instead of sending Tab to
      // the shell (the shell's own completion cannot be shown in a dropdown).
      if (data === "\t") {
        if (completion) {
          // Cycle through the offered entries.
          setCompletion((prev) =>
            prev
              ? { ...prev, index: (prev.index + 1) % prev.entries.length }
              : prev,
          );
        } else {
          openCompletion(id);
        }
        return;
      }

      // Enter with a dropdown open INSERTS the highlighted entry rather than
      // running the line — otherwise the user would execute a half-typed path.
      if ((data === "\r" || data === "\n") && completion) {
        const entry = completion.entries[completion.index];
        if (entry) return commitCompletion(entry);
      }

      // Escape dismisses an open dropdown instead of reaching the shell.
      if (data === "\u001b" && completion) {
        setCompletion(null);
        return;
      }

      // Any other key dismisses an open dropdown and then behaves normally.
      if (completion) setCompletion(null);

      const line = linesRef.current.get(id) ?? "";
      if (data === "\r" || data === "\n") {
        linesRef.current.set(id, "");
      } else if (data === "\u007f" || data === "\b") {
        // Backspace.
        linesRef.current.set(id, line.slice(0, -1));
      } else if (data === "\u0015") {
        // Ctrl-U clears the line.
        linesRef.current.set(id, "");
      } else if (data === "\u0003") {
        // Ctrl-C abandons the line.
        linesRef.current.set(id, "");
      } else if (!data.startsWith("\u001b")) {
        // Ignore escape sequences (arrow keys etc.) — they do not insert text.
        linesRef.current.set(id, line + data);
      }

      window.hermesAPI.terminalWrite({ id, data });
    },
    [completion, openCompletion, commitCompletion],
  );

  // Keep the ref pointing at the latest handler without re-subscribing xterm,
  // which would tear down the terminal on every keystroke.
  useEffect(() => {
    onInputRef.current = handleTerminalInput;
  }, [handleTerminalInput]);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Record each session's starting directory so relative fragments resolve.
  //
  // Taken from `attachSession` rather than a separate IPC: the caller already
  // knows the cwd it created the pty with, and inventing a getter would add a
  // round trip for information we were handed. The dock's own default (empty
  // string) resolves relative paths against the process cwd in main, matching
  // what the shell itself does.

  const refit = useCallback((): void => {
    const id = activeId;
    const dock = id ? sessionsRef.current.get(id) : null;
    if (!dock) return;
    // One frame: the container must be laid out at its visible size before
    // measuring, otherwise fit() reads the hidden geometry again.
    requestAnimationFrame(() => {
      dock.fit.fit();
      window.hermesAPI.terminalResize({
        id: dock.state.id,
        cols: dock.term.cols,
        rows: dock.term.rows,
      });
    });
  }, [activeId]);

  useImperativeHandle(ref, () => ({ attachSession, refit }), [
    attachSession,
    refit,
  ]);

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
    <div
      className="terminal-dock"
      style={dockHeight === undefined ? undefined : { height: dockHeight }}
    >
      <div
        className="terminal-dock-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        aria-label="Resize terminal"
        title="Drag to resize"
      />
      <div className="terminal-dock-tabs">
        <button
          type="button"
          className="terminal-dock-tab-new"
          onClick={onNewSession}
          aria-label="New terminal session"
          title="New terminal session"
        >
          <Plus size={13} />
        </button>
        <div
          className="terminal-dock-tabs-scroll"
          role="tablist"
          ref={tabsScrollRef}
          onWheel={onTabsWheel}
        >
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
        </div>
      </div>
      <div className="terminal-dock-body" ref={containerRef} />

      {/* `cd` completion dropdown. Rendered INSIDE the dock but absolutely
          positioned, so it floats above the terminal without disturbing xterm's
          measured geometry (a sibling in normal flow would resize the pane and
          make the terminal rewrap on every Tab). */}
      {completion && (
        <div
          className="terminal-complete"
          role="listbox"
          aria-label="Directory suggestions"
        >
          {completion.entries.map((entry, i) => (
            <button
              key={entry.name}
              type="button"
              role="option"
              aria-selected={i === completion.index}
              className={`terminal-complete-item ${
                i === completion.index ? "is-active" : ""
              }`}
              // mousedown, not click: clicking must not blur the terminal
              // before the insertion is sent.
              onMouseDown={(e) => {
                e.preventDefault();
                commitCompletion(entry);
              }}
              onMouseEnter={() =>
                setCompletion((prev) => (prev ? { ...prev, index: i } : prev))
              }
            >
              {entry.name}
            </button>
          ))}
          <div className="terminal-complete-hint">
            Tab cycles · Enter inserts · Esc dismisses
          </div>
        </div>
      )}
    </div>
  );
});
