import { memo, useEffect, useRef, useState } from "react";
import { Play, ChevronDown, ChevronRight, Folder, Check, X } from "lucide-react";
import {
  readOnFinishSelection,
  toggleOnFinishSelection,
  writeOnFinishSelection,
  type OnFinishCommand,
} from "./onFinish";

interface OnFinishChipProps {
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
}: OnFinishChipProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [commands, setCommands] = useState<OnFinishCommand[]>([]);
  const [selected, setSelected] = useState<string[]>(() =>
    readOnFinishSelection(scope),
  );
  // Folders start collapsed (matching the Commands page default).
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Load commands when the dropdown opens, so edits made on the Commands page
  // show up without remounting the chat.
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, scope]);

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
        <div className="chat-ctxfolder-dropdown chat-onfinish-dropdown">
          <div className="chat-ctxfolder-dropdown-header">
            {armed
              ? `Runs after each reply · in this order (${selected.length})`
              : "Pick commands to run after each reply"}
          </div>

          {/* The queue in RUN ORDER — the only place it is shown while in the
              chat, and the place to fix it. */}
          {armed && (
            <>
              <div className="chat-onfinish-queue">
                {selected.map((id, index) => {
                  const cmd = commands.find((c) => c.id === id);
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
                        {cmd?.name ?? "(deleted)"}
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
                            {isSelected && (
                              <span className="chat-onfinish-item-order">
                                {index + 1}
                              </span>
                            )}
                            <span className="chat-ctxfolder-dropdown-item-check">
                              {isSelected && <Check size={12} />}
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
