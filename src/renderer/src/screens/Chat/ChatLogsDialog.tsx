import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  FileText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  AppModal,
  AppModalDescription,
  AppModalTitle,
} from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";

export type LogTab = "errors" | "requests";

interface LogState {
  content: string;
  path: string;
  loading: boolean;
}

const REQUEST_LINE_PATTERN =
  /(?:API call|API Request|API Response|model=|provider=|HTTP \d+|Retrying API|Failover|fallback|InternalServerError|AuthenticationError)/i;

const ERROR_LINE_PATTERN =
  /(?:ERROR|CRITICAL|Traceback|Exception|Error code:|HTTP [45]\d\d|failed|fatal)/i;

const WARN_LINE_PATTERN = /(?:WARNING|warn|Retrying)/i;

export function ChatLogsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<LogTab>("errors");
  const [errorsState, setErrorsState] = useState<LogState>({
    content: "",
    path: "",
    loading: false,
  });
  const [requestsState, setRequestsState] = useState<LogState>({
    content: "",
    path: "",
    loading: false,
  });
  const [filterQuery, setFilterQuery] = useState("");
  const [requestsOnly, setRequestsOnly] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement | null>(null);

  const fetchLog = useCallback(async (targetTab: LogTab) => {
    const isErrors = targetTab === "errors";
    const fileName = isErrors ? "errors.log" : "agent.log";
    if (isErrors) {
      setErrorsState((prev) => ({ ...prev, loading: true }));
    } else {
      setRequestsState((prev) => ({ ...prev, loading: true }));
    }

    try {
      const res = await window.hermesAPI?.readLogs?.(fileName, 600);
      const update = {
        content: res?.content ?? "",
        path: res?.path ?? "",
        loading: false,
      };
      if (isErrors) {
        setErrorsState(update);
      } else {
        setRequestsState(update);
      }
    } catch {
      const fallback = { content: "", path: "", loading: false };
      if (isErrors) setErrorsState(fallback);
      else setRequestsState(fallback);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchLog("errors");
    void fetchLog("requests");
  }, [open, fetchLog]);

  const activeState = tab === "errors" ? errorsState : requestsState;

  const rawLines = useMemo(() => {
    if (!activeState.content) return [];
    return activeState.content.split("\n");
  }, [activeState.content]);

  const filteredLines = useMemo(() => {
    let lines = rawLines;
    if (tab === "requests" && requestsOnly) {
      lines = lines.filter((line) => REQUEST_LINE_PATTERN.test(line));
    }
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      lines = lines.filter((line) => line.toLowerCase().includes(q));
    }
    return lines;
  }, [rawLines, tab, requestsOnly, filterQuery]);

  // Auto-scroll to bottom so latest entries are immediately in view
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tab, filteredLines.length]);

  const handleCopy = useCallback(async () => {
    const text = filteredLines.join("\n");
    if (!text) return;
    try {
      if (window.hermesAPI?.copyToClipboard) {
        await window.hermesAPI.copyToClipboard(text);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // copy failed silently
    }
  }, [filteredLines]);

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      className="chat-logs-dialog"
    >
      <div className="chat-logs-header">
        <div className="chat-logs-title-group">
          <AppModalTitle className="chat-logs-title">
            <FileText size={16} aria-hidden />
            <span>{t("chat.logs.title", { defaultValue: "Logs" })}</span>
          </AppModalTitle>
          <AppModalDescription className="chat-logs-subtitle">
            {t("chat.logs.description", {
              defaultValue:
                "System diagnostics and provider request logs for debugging",
            })}
          </AppModalDescription>
        </div>
        <button
          type="button"
          className="btn-ghost chat-logs-close"
          onClick={onClose}
          aria-label={t("common.close", { defaultValue: "Close" })}
        >
          <X size={16} />
        </button>
      </div>

      <div className="chat-logs-tabs-bar">
        <div className="chat-logs-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "errors"}
            className={`chat-logs-seg-btn ${tab === "errors" ? "active" : ""}`}
            onClick={() => setTab("errors")}
          >
            <AlertTriangle size={13} aria-hidden />
            <span>{t("chat.logs.errorsTab", { defaultValue: "Crash & Errors" })}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "requests"}
            className={`chat-logs-seg-btn ${tab === "requests" ? "active" : ""}`}
            onClick={() => setTab("requests")}
          >
            <ArrowLeftRight size={13} aria-hidden />
            <span>{t("chat.logs.requestsTab", { defaultValue: "Request Log" })}</span>
          </button>
        </div>

        <div className="chat-logs-actions">
          {tab === "requests" && (
            <button
              type="button"
              className={`chat-logs-chip ${requestsOnly ? "active" : ""}`}
              onClick={() => setRequestsOnly((v) => !v)}
              title={
                requestsOnly
                  ? t("chat.logs.requestsOnly", { defaultValue: "Requests only" })
                  : t("chat.logs.allLines", { defaultValue: "All lines" })
              }
            >
              {requestsOnly
                ? t("chat.logs.requestsOnly", { defaultValue: "Requests only" })
                : t("chat.logs.allLines", { defaultValue: "All lines" })}
            </button>
          )}

          <button
            type="button"
            className={`chat-logs-chip ${wrapLines ? "active" : ""}`}
            onClick={() => setWrapLines((v) => !v)}
            title={t("chat.logs.wrap", { defaultValue: "Wrap lines" })}
          >
            {t("chat.logs.wrap", { defaultValue: "Wrap lines" })}
          </button>

          <button
            type="button"
            className="btn btn-sm btn-secondary chat-logs-btn"
            onClick={handleCopy}
            disabled={filteredLines.length === 0}
            title={
              copied
                ? t("chat.logs.copied", { defaultValue: "Copied" })
                : t("chat.logs.copy", { defaultValue: "Copy" })
            }
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>
              {copied
                ? t("chat.logs.copied", { defaultValue: "Copied" })
                : t("chat.logs.copy", { defaultValue: "Copy" })}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-secondary chat-logs-btn"
            onClick={() => void fetchLog(tab)}
            disabled={activeState.loading}
            title={t("chat.logs.refresh", { defaultValue: "Refresh" })}
          >
            <RefreshCw
              size={13}
              className={activeState.loading ? "chat-logs-spin" : ""}
            />
            <span>{t("chat.logs.refresh", { defaultValue: "Refresh" })}</span>
          </button>
        </div>
      </div>

      <div className="chat-logs-toolbar">
        <div className="chat-logs-filter-wrap">
          <Search size={13} className="chat-logs-filter-icon" aria-hidden />
          <input
            type="text"
            className="chat-logs-filter-input"
            placeholder={t("chat.logs.filterPlaceholder", {
              defaultValue: "Filter log entries...",
            })}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery && (
            <button
              type="button"
              className="chat-logs-filter-clear"
              onClick={() => setFilterQuery("")}
              aria-label="Clear filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="chat-logs-count">
          {t("chat.logs.linesCount", {
            visible: filteredLines.length,
            total: rawLines.length,
            defaultValue: `${filteredLines.length} / ${rawLines.length} lines`,
          })}
        </div>
      </div>

      <div className="chat-logs-body">
        {filteredLines.length === 0 ? (
          <div className="chat-logs-empty">
            <FileText size={28} className="chat-logs-empty-icon" />
            <p>
              {activeState.loading
                ? t("chat.logs.loading", { defaultValue: "Loading logs..." })
                : t("chat.logs.empty", {
                    defaultValue: "No log entries found.",
                  })}
            </p>
          </div>
        ) : (
          <pre
            ref={scrollRef}
            className={`chat-logs-pre ${wrapLines ? "is-wrapped" : ""}`}
          >
            {filteredLines.map((line, idx) => {
              const isErr = ERROR_LINE_PATTERN.test(line);
              const isWarn = !isErr && WARN_LINE_PATTERN.test(line);
              const isApi = !isErr && !isWarn && REQUEST_LINE_PATTERN.test(line);
              let className = "chat-logs-line";
              if (isErr) className += " chat-logs-line--error";
              else if (isWarn) className += " chat-logs-line--warn";
              else if (isApi) className += " chat-logs-line--api";
              return (
                <span key={idx} className={className}>
                  {line}
                </span>
              );
            })}
          </pre>
        )}
      </div>

      {activeState.path && (
        <div className="chat-logs-footer">
          <span className="chat-logs-path" title={activeState.path}>
            {activeState.path}
          </span>
        </div>
      )}
    </AppModal>
  );
}
