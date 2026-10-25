import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Play, ChevronDown, ChevronRight, Folder, Check, X } from "lucide-react";
import {
  readOnFinishSelection,
  toggleOnFinishSelection,
  writeOnFinishSelection,
  type OnFinishCommand,
} from "./onFinish";

import { decodeTerminalInput, encodeTerminalInput, MAX_TERMINAL_TEXT, TERMINAL_KEYS } from "./onFinishTerminal";

const PICKABLE_KEYS = Object.keys(TERMINAL_KEYS).filter((key) => key !== "r" && key !== "r + Enter");

function KeyPicker({ value, onChange }: { value: string; onChange: (key: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const outside = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const close = (): void => { setOpen(false); trigger.current?.focus(); };
  return <div className="chat-onfinish-key-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" ref={trigger} aria-label="On-Finish key" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>{value} <ChevronDown size={12} aria-hidden="true" /></button>
    {open && <div id={id} role="listbox" aria-label="On-Finish keys" className="chat-onfinish-keys"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        if ((event.key === "Enter" || event.key === " ") && index >= 0) {
          event.preventDefault(); options[index].click(); return;
        }
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : event.key === "ArrowDown" ? (index + 1) % options.length
          : event.key === "ArrowUp" ? (index - 1 + options.length) % options.length : -1;
        if (next >= 0) { event.preventDefault(); options[next].focus(); options[next].scrollIntoView?.({ block: "nearest" }); }
      }}>
      {PICKABLE_KEYS.map((key) => <button type="button" role="option" tabIndex={-1} aria-selected={key === value}
        key={key} onClick={() => { onChange(key); close(); }}>{key}</button>)}
    </div>}
  </div>;
}

interface OnFinishChipProps {
  getLiveSessions?: () => { id: string; title: string }[];
  lastError?: string | null;
  /** True while the queue is executing (drives the spinner/label). */
  running: boolean;
  /**
   * This chat's identity scope. Each session owns its own ordered queue, so
   * the chip must read/write under the same key the chat reads.
   */
  scope: string;
}

/**
 * On-Finish control in the chat input footer, next to the context-folder chip
 * and built to the SAME interaction pattern: a `chat-meta-chip` whose click
 * opens a dropdown.
 *
 * The chip is BOTH the arming switch and the picker, which is what makes the
 * flow one action instead of two:
 *
 *   click chip  → dropdown opens listing every command, grouped/foldered
 *   tick items  → the queue is (re)armed automatically
 *   untick all  → disarmed; nothing runs on finish
 *
 * There is deliberately no separate arm toggle: an armed-but-empty queue is a
 * state the user cannot observe, and "I ticked commands but nothing ran" is the
 * exact failure that ambiguity produces.
 */
export const OnFinishChip = memo(function OnFinishChip({
  running,
  scope,
  getLiveSessions,
  lastError,
}: OnFinishChipProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<React.CSSProperties>({});
  const [terminals, setTerminals] = useState<{ id: string; title: string }[]>([]);
  const [terminalId, setTerminalId] = useState("");
  const [terminalKey, setTerminalKey] = useState("Ctrl+C");
  const [inputMode, setInputMode] = useState("key");
  const [terminalText, setTerminalText] = useState("");
  const [appendEnter, setAppendEnter] = useState(false);
  const [commands, setCommands] = useState<OnFinishCommand[]>([]);
  const [selected, setSelected] = useState<string[]>(() =>
    readOnFinishSelection(scope),
  );
  // Folders start collapsed (matching the Commands page default).
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = (): void => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const above = rect.top - top - 12;
      const below = top + height - rect.bottom - 12;
      const upwards = above >= below;
      setPlacement({
        position: "fixed", margin: 0, bottom: "auto", insetInlineStart: "auto",
        left: Math.max(left + 8, Math.min(rect.left, left + width - Math.min(340, width - 16) - 8)),
        top: upwards ? Math.max(top + 8, rect.top - 6) : rect.bottom + 6,
        transform: upwards ? "translateY(-100%)" : undefined,
        width: Math.min(340, width - 16),
        maxHeight: Math.max(0, Math.min(520, upwards ? above : below)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [isOpen]);


  // Load commands when the dropdown opens, so edits made on the Commands page
  // show up without remounting the chat.
  useEffect(() => {
    if (!isOpen) return;
    const live = getLiveSessions?.() ?? [];
    setTerminals(live);
    setTerminalId((id) => live.some((session) => session.id === id) ? id : live[0]?.id ?? "");
    let cancelled = false;
    void window.hermesAPI
      .listCommands()
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return;
        const items = (list as OnFinishCommand[]).map((c) => ({
          ...c,
          folder: (c as { folder?: string }).folder ?? "",
        }));
        setCommands(items);
        // Re-read the selection too: it may have been edited on the Commands
        // page while this chat was open. Scoped, so another chat's queue is
        // never picked up here.
        const fresh = readOnFinishSelection(scope);
        setSelected(fresh);
        setCollapsedFolders(new Set(items.map((c) => c.folder ?? "")));
      })
      .catch(() => {
        /* leave the list empty rather than throwing in a chip */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, scope, getLiveSessions]);

  // Close on outside click / Escape, matching the folder chip.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  // Persist helper: writes through the shared store, which also notifies the
  // chat (see ON_FINISH_CHANGE_EVENT) so the dock appears/disappears live.
  const persist = (next: string[]): void => {
    setSelected(next);
    writeOnFinishSelection(next, scope);
  };

  const toggle = (id: string): void => {
    persist(toggleOnFinishSelection(selected, id));
  };

  const toggleFolder = (folder: string): void => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  // Group into folders + Ungrouped, same shape the Commands page uses.
  const folders = [
    ...new Set(
      commands.map((c) => (c as { folder?: string }).folder ?? "").filter(Boolean),
    ),
  ].sort();
  const groups: { folder: string; items: OnFinishCommand[] }[] = [
    ...folders.map((folder) => ({
      folder,
      items: commands.filter(
        (c) => ((c as { folder?: string }).folder ?? "") === folder,
      ),
    })),
    {
      folder: "",
      items: commands.filter(
        (c) => !((c as { folder?: string }).folder ?? ""),
      ),
    },
  ].filter((g) => g.items.length > 0);

  const armed = selected.length > 0;
  let terminalAction: string | null = null;
  const target = terminals.find((session) => session.id === terminalId);
  if (target) {
    try {
      terminalAction = encodeTerminalInput({ terminalId, title: target.title, enter: appendEnter,
        ...(inputMode === "key" ? { key: terminalKey } : { text: terminalText }),
      });
    } catch { /* Invalid or incomplete input stays unarmed. */ }
  }

  return (
    <div className="chat-ctxfolder-picker" ref={containerRef}>
      <button
        className={`chat-meta-chip${armed ? " chat-meta-chip--active" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        title={
          armed
            ? `On-Finish: ${selected.length} command${selected.length === 1 ? "" : "s"} run after each reply`
            : "On-Finish: pick commands to run after each reply"
        }
        aria-haspopup="true"
        aria-expanded={isOpen}
        type="button"
      >
        {running ? (
          <span className="chat-onfinish-spin-dot" aria-hidden="true" />
        ) : (
          <Play size={13} />
        )}
        <span>
          {running
            ? `On-Finish (${selected.length})…`
            : armed
              ? `On-Finish (${selected.length})`
              : "On-Finish"}
        </span>
      </button>

      {isOpen && (
        <div className="chat-ctxfolder-dropdown chat-onfinish-dropdown" style={placement}>
          <div className="chat-ctxfolder-dropdown-header">
            {armed
              ? `Runs after each reply · in this order (${selected.length})`
              : "Pick commands to run after each reply"}
          </div>

          {lastError && <div role="alert" className="chat-ctxfolder-dropdown-empty">{lastError}</div>}
          <div className="chat-onfinish-terminal-input">
            <label>Existing terminal
              <select aria-label="On-Finish terminal" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                {!terminals.length && <option value="">Open a terminal first</option>}
                {terminals.map((session) => <option key={session.id} value={session.id}>{session.title} · {session.id.slice(-6)}</option>)}
              </select>
            </label>
            <div className="chat-onfinish-input-row">
              <label>Input type
                <select aria-label="On-Finish input type" value={inputMode} onChange={(e) => setInputMode(e.target.value)}>
                  <option value="key">Key</option><option value="text">Literal text</option>
                </select>
              </label>
              <div className="chat-onfinish-input-field"><span>{inputMode === "key" ? "Send key" : "Literal text"}</span>
                {inputMode === "key" ? <KeyPicker value={terminalKey} onChange={setTerminalKey} />
                  : <input aria-label="On-Finish text" placeholder="e.g. r" value={terminalText} maxLength={MAX_TERMINAL_TEXT} onChange={(e) => setTerminalText(e.target.value)} />}
              </div>
            </div>
            <div className="chat-onfinish-input-row">
              <label className="chat-onfinish-enter"><input type="checkbox" checked={appendEnter} onChange={(e) => setAppendEnter(e.target.checked)} />Then Enter</label>
              <button type="button" className="chat-ctxfolder-dropdown-item" disabled={!terminalAction} onClick={() => {
                if (terminalAction && !selected.includes(terminalAction)) persist([...selected, terminalAction]);
              }}>Add terminal input</button>
            </div>
            <small>{inputMode === "text" ? "Sends text exactly (e.g. r). 1–256 characters, no control characters." : "Sends one control key to this terminal only."}</small>
          </div>

          {/* The queue in RUN ORDER — the only place it is shown while in the
              chat, and the place to fix it. */}
          {armed && (
            <>
              <div className="chat-onfinish-queue">
                {selected.map((id, index) => {
                  const cmd = commands.find((c) => c.id === id);
                  const input = decodeTerminalInput(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className="chat-onfinish-queue-chip"
                      onClick={() => toggle(id)}
                      title={`#${index + 1} — click to remove`}
                    >
                      <span className="chat-onfinish-queue-index">
                        {index + 1}
                      </span>
                      <span className="chat-onfinish-queue-name">
                        {input ? `${input.title}: ${input.key ?? JSON.stringify(input.text)}${input.enter ? " + Enter" : ""}` : cmd?.name ?? "(deleted)"}
                      </span>
                      <X size={10} />
                    </button>
                  );
                })}
              </div>
              <div className="chat-ctxfolder-dropdown-divider" />
            </>
          )}

          <div className="chat-onfinish-scroll">
            {commands.length === 0 ? (
              <div className="chat-ctxfolder-dropdown-empty">
                No saved commands yet
              </div>
            ) : (
              groups.map(({ folder, items }) => {
                const collapsed = collapsedFolders.has(folder);
                const label = folder || "Ungrouped";
                return (
                  <div key={folder || "__ungrouped__"}>
                    <button
                      type="button"
                      className="chat-onfinish-group"
                      onClick={() => toggleFolder(folder)}
                    >
                      {collapsed ? (
                        <ChevronRight size={11} />
                      ) : (
                        <ChevronDown size={11} />
                      )}
                      {folder ? (
                        <Folder size={11} />
                      ) : (
                        <span className="command-group-dot" />
                      )}
                      <span className="chat-onfinish-group-label">{label}</span>
                      <span className="chat-onfinish-group-count">
                        {
                          items.filter((c) => selected.includes(c.id)).length
                        }
                        /{items.length}
                      </span>
                    </button>
                    {!collapsed &&
                      items.map((cmd) => {
                        const index = selected.indexOf(cmd.id);
                        const isSelected = index >= 0;
                        return (
                          <button
                            key={cmd.id}
                            type="button"
                            className={`chat-ctxfolder-dropdown-item${
                              isSelected
                                ? " chat-ctxfolder-dropdown-item--active"
                                : ""
                            }`}
                            onClick={() => toggle(cmd.id)}
                            title={cmd.command}
                          >
                            <span className="chat-ctxfolder-dropdown-item-name">
                              {cmd.name}
                            </span>
                            <span className="chat-onfinish-item-selection">
                              {isSelected && (
                                <span className="chat-onfinish-item-order">
                                  {index + 1}
                                </span>
                              )}
                              <span className="chat-ctxfolder-dropdown-item-check">
                                {isSelected && <Check size={12} />}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>

          <div className="chat-ctxfolder-dropdown-divider" />
          <button
            type="button"
            className="chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--open"
            onClick={() => persist([])}
          >
            <span>Clear queue{armed ? ` (${selected.length})` : ""}</span>
          </button>
        </div>
      )}
    </div>
  );
});
