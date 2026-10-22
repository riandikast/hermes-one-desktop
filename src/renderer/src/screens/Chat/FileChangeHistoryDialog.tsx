import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, FileText, FolderSearch, History, X } from "lucide-react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import {
  loadFileChangeHistory,
  mergeFileChangeHistory,
  resolveHistoryExplorerTarget,
} from "./fileChangeHistory";
import { FileChangesDialog } from "./FileChangesDialog";
import { WorktreePanel } from "./WorktreePanel";

import type { ChatMessage, FileChange } from "./types";

export function FileChangeHistoryDialog({
  sessionId,
  messages,
  onClose,
  onOpenFileChanges,
  cwd,
  onOpenExplorer,
}: {
  sessionId: string | null;
  messages: ChatMessage[];
  onClose: () => void;
  onOpenFileChanges?: (changes: FileChange[]) => void;
  cwd?: string;
  onOpenExplorer?: (path: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [stored, setStored] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(!!sessionId);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<FileChange[] | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [copyingContent, setCopyingContent] = useState(false);
  const copyContent = async (path: string): Promise<void> => {
    setCopyingContent(true);
    setActionStatus(t("chat.fileChangeHistory.copyingContent"));
    try {
      const target = resolveHistoryExplorerTarget(path, cwd);
      if (!target) {
        setActionStatus(t("chat.fileChangeHistory.noCwd"));
        return;
      }
      // readFile is local-only; never read a coincidentally matching local path
      // for a remote/SSH session. No remote whole-file API exists yet.
      if (await window.hermesAPI.isRemoteMode()) {
        setActionStatus(t("chat.fileChangeHistory.remoteContentUnavailable"));
        return;
      }
      const result = await window.hermesAPI.readFile(target.path, Number.MAX_SAFE_INTEGER);
      if (result === null) {
        setActionStatus(t("chat.fileChangeHistory.contentUnavailable"));
      } else if (result.truncated !== false) {
        setActionStatus(t("chat.fileChangeHistory.contentTruncated"));
      } else if (/[\u0000-\u0008\u000e-\u001f\ufffd]/.test(result.content)) {
        setActionStatus(t("chat.fileChangeHistory.contentBinary"));
      } else {
        await window.hermesAPI.copyToClipboard(result.content);
        setActionStatus(t("chat.fileChangeHistory.contentCopied"));
      }
    } catch {
      setActionStatus(t("chat.fileChangeHistory.copyContentFailed"));
    } finally {
      setCopyingContent(false);
    }
  };
  const [explorer, setExplorer] = useState<ReturnType<typeof resolveHistoryExplorerTarget>>(null);
  useEffect(() => {
    let cancelled = false;
    setStored([]);
    setError(false);
    setLoading(!!sessionId);
    if (sessionId) {
      void loadFileChangeHistory(sessionId)
        .then((history) => {
          if (!cancelled) setStored(history);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);
  const turns = useMemo(
    () => mergeFileChangeHistory(stored, messages),
    [stored, messages],
  );
  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="file-change-history-dialog"
    >
      <div className="file-change-history-header">
        <History size={18} aria-hidden />
        <AppModalTitle>{t("chat.fileChangeHistory.title")}</AppModalTitle>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>
      </div>
      <div className="file-change-history-body" aria-busy={loading}>
        {loading ? (
          <p role="status">{t("chat.fileChangeHistory.loading")}</p>
        ) : error ? (
          <div role="alert">
            <p>{t("chat.fileChangeHistory.error")}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("chat.fileChangeHistory.retry")}
            </button>
          </div>
        ) : turns.length === 0 ? (
          <p>{t("chat.fileChangeHistory.empty")}</p>
        ) : (
          turns.map((turn) => (
            <details key={turn.prompt.id} className="file-change-history-turn">
              <summary>
                <ChevronDown size={16} aria-hidden />
                <span>{turn.prompt.content}</span>
                <span className="file-change-history-count">
                  {t("chat.fileChangeHistory.files", {
                    count: turn.changes.length,
                  })}
                </span>
              </summary>
              <div className="file-change-history-files">
                {turn.changes.map((change) => {
                  const target = resolveHistoryExplorerTarget(change.path, cwd);
                  const canExplore = !!target;
                  const status =
                    change.after === null
                      ? "deleted"
                      : change.before === null && change.beforeKnown
                        ? "created"
                        : "edited";
                  return (
                    <div className="file-change-history-file" key={change.path}>
                      <button
                        type="button"
                        className="file-change-history-path"
                        title={change.path}
                        onClick={() => {
                          setSelected([change]);
                          onOpenFileChanges?.([change]);
                        }}
                      >
                        {change.path}
                      </button>
                      <span
                        className={`file-change-history-status file-change-history-status--${status}`}
                      >
                        {t(`chat.fileChangeHistory.${status}`)}
                      </span>
                      <button
                        type="button"
                        className="file-change-history-action"
                        aria-label={`${t("chat.fileChangeHistory.copyPath")}: ${change.path}`}
                        title={t("chat.fileChangeHistory.copyPath")}
                        onClick={() => {
                          void window.hermesAPI
                            .copyToClipboard(change.path)
                            .then(() =>
                              setActionStatus(
                                t("chat.fileChangeHistory.copied"),
                              ),
                            )
                            .catch(() =>
                              setActionStatus(
                                t("chat.fileChangeHistory.copyFailed"),
                              ),
                            );
                        }}
                      >
                        <Copy size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="file-change-history-action"
                        disabled={copyingContent}
                        aria-label={`${t("chat.fileChangeHistory.copyContent")}: ${change.path}`}
                        title={t("chat.fileChangeHistory.copyContent")}
                        onClick={() => void copyContent(change.path)}
                      >
                        <FileText size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="file-change-history-action"
                        disabled={!canExplore}
                        aria-label={`${t("chat.showWorktree")}: ${change.path}`}
                        title={
                          canExplore
                            ? t("chat.showWorktree")
                            : t("chat.fileChangeHistory.noCwd")
                        }
                        onClick={() => {
                          if (target) {
                            setExplorer(target);
                            onOpenExplorer?.(target.path);
                          }
                        }}
                      >
                        <FolderSearch size={16} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          ))
        )}
      </div>
      {actionStatus && (
        <p className="file-change-history-feedback" role="status">
          {actionStatus}
        </p>
      )}
      {explorer && (
        <AppModal open onOpenChange={(open) => { if (!open) setExplorer(null); }} className="file-change-history-explorer">
          <div className="file-change-history-header">
            <AppModalTitle>{t("chat.showWorktree")}</AppModalTitle>
            <button type="button" className="btn btn-ghost" aria-label={t("common.close")} onClick={() => setExplorer(null)}><X size={18} /></button>
          </div>
          <WorktreePanel folderPaths={[explorer.folder]} selectedPath={explorer.path} embedded open />
        </AppModal>
      )}
      {selected && (
        <FileChangesDialog
          changes={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </AppModal>
  );
}
