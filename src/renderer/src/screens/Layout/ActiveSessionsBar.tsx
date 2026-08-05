import { memo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Plus, FileCode } from "../../assets/icons";
import { OrbLoader } from "../../components/OrbLoader";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import type { ChatRun } from "./chatRuns";

export interface ProfileAppearance {
  color?: string | null;
  avatar?: string | null;
}

/**
 * The window's top strip. Doubles as the title-bar drag region (browser-style):
 * the strip itself is draggable, while the conversation chips on top of it stay
 * clickable. When several sessions are open (background sessions / multi-agent)
 * it shows a chip per session to switch between them and watch each stream live.
 * With only a blank scratch conversation it renders empty — just a drag area —
 * so no vertical space is wasted before there is a real session to show.
 */
export const ActiveSessionsBar = memo(function ActiveSessionsBar({
  runs,
  activeRunId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onReorder,
  onNew,
  getAppearance,
}: {
  runs: ChatRun[];
  activeRunId: string;
  onSelect: (runId: string) => void;
  /** Close (and stop, if running) a conversation tab. */
  onClose: (runId: string) => void;
  onCloseOthers?: (runId: string) => void;
  onCloseToRight?: (runId: string) => void;
  onReorder?: (sourceRunId: string, targetRunId: string) => void;
  /** Open a fresh conversation tab (browser-style new-tab button). */
  onNew: () => void;
  /** Resolve a profile's avatar/colour for its chip. */
  getAppearance?: (profile: string) => ProfileAppearance;
}): React.JSX.Element {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{
    runId: string;
    x: number;
    y: number;
  } | null>(null);
  const draggedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".active-session-context-menu")) {
        setContextMenu(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  const anyLoading = runs.some((r) => r.loading);
  const hasRealSession = runs.some(
    (r) => r.sessionId || r.title || r.targetView,
  );
  // Nothing real to switch to yet → leave the strip empty (pure drag area).
  const showChips = runs.length > 1 || anyLoading || hasRealSession;

  return (
    <div className="active-sessions-bar" role="tablist">
      {showChips &&
        runs.map((run) => {
          const active = run.runId === activeRunId;
          const label = run.title || t("sessions.newConversation");
          const appearance = getAppearance?.(run.profile);

          return (
            <div
              key={run.runId}
              role="tab"
              aria-selected={active}
              draggable={true}
              onDragStart={(e) => {
                draggedRunIdRef.current = run.runId;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const source = draggedRunIdRef.current;
                if (source && source !== run.runId) {
                  onReorder?.(source, run.runId);
                }
                draggedRunIdRef.current = null;
              }}
              className={`active-session-chip ${active ? "active" : ""} ${
                run.loading ? "loading" : ""
              }`}
              onClick={() => onSelect(run.runId)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  runId: run.runId,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              title={`${run.profile} — ${label}`}
            >
              {run.filePath ? (
                <span className="active-session-chip-avatar active-session-chip-file">
                  <FileCode size={14} />
                </span>
              ) : run.loading ? (
                <span
                  className="active-session-chip-avatar active-session-chip-orb"
                  aria-label={run.profile}
                >
                  <OrbLoader state="composing" size={20} />
                </span>
              ) : (
                <ProfileAvatar
                  name={run.profile}
                  color={appearance?.color}
                  avatar={appearance?.avatar}
                  size={18}
                />
              )}
              <span className="active-session-chip-title">{label}</span>
              <button
                type="button"
                className="active-session-chip-close"
                title={t("sessions.closeTab")}
                aria-label={t("sessions.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(run.runId);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      {showChips && (
        <button
          type="button"
          className="active-session-new"
          title={t("sessions.newConversation")}
          aria-label={t("sessions.newConversation")}
          onClick={onNew}
        >
          <Plus size={14} />
        </button>
      )}

      {contextMenu &&
        createPortal(
          <div
            className="active-session-context-menu"
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 9999,
            }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const targetId = contextMenu.runId;
                setContextMenu(null);
                onClose(targetId);
              }}
            >
              Close Tab
            </button>

            {runs.length > 1 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetId = contextMenu.runId;
                  setContextMenu(null);
                  onCloseOthers?.(targetId);
                }}
              >
                Close Others
              </button>
            )}

            {runs.findIndex((r) => r.runId === contextMenu.runId) <
              runs.length - 1 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetId = contextMenu.runId;
                  setContextMenu(null);
                  onCloseToRight?.(targetId);
                }}
              >
                Close Tabs to the Right
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
});
