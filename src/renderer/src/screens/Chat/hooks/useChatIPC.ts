import { useCallback, useEffect, useRef } from "react";
import { isBubbleMessage, markActiveTurnFailed } from "../chatMessages";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";
import {
  dbItemsToChatMessages,
  highestDbId,
  reconcileAfterDbRefresh,
  reconcileTailAfterDbRefresh,
  type DbHistoryItem,
} from "../sessionHistory";
import {
  liveToolEventFromProgress,
  upsertLiveToolEvent,
} from "../liveToolEvents";
import { upsertLiveReasoningChunk } from "../liveReasoningEvents";

interface UseChatIPCArgs {
  /** This conversation's run id. Events tagged with a different runId belong
   *  to another mounted/background chat and are ignored. */
  runId: string;
  /** The session currently visible in this Chat, if already known. */
  sessionScopeId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
}

/**
 * True when an incoming event belongs to this conversation. Multiple chats run
 * concurrently and share the same global IPC channels, so each listener must
 * drop events whose runId isn't ours.
 */
export function eventMatchesRun(eventRunId: string, ownRunId: string): boolean {
  return eventRunId === ownRunId;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * The dashboard/gateway is the canonical event source where possible; the
 * polling refresh bridges persisted DB rows that the streaming API still omits
 * today, especially reasoning and tool result rows.
 */
export function useChatIPC({
  runId,
  sessionScopeId,
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setUsage,
  activeTurnRef,
}: UseChatIPCArgs): void {
  const reasoningSegmentClosedRef = useRef(false);
  const dbPollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const dbPollInFlightRef = useRef(false);
  const acceptedSessionIdRef = useRef<string | null>(sessionScopeId);
  /**
   * Highest state.db id the renderer has already reconciled.
   *
   * The mid-turn poll only ever needs rows NEWER than this, so it reads and
   * reconciles a BOUNDED tail instead of the whole transcript. Measured on real
   * sessions: a full read is ~180 ms of blocking SQLite on a 21k-row session,
   * versus ~0.2 ms for the id-scoped tail — and this poll runs every 750 ms, so
   * the full read was stalling the main thread ~240 ms/sec (the visible stutter,
   * worst during prompt processing because that is when the poll is active).
   */
  const lastSyncedDbIdRef = useRef(0);

  const stopDbPolling = useCallback((): void => {
    if (dbPollRef.current !== null) {
      window.clearInterval(dbPollRef.current);
      dbPollRef.current = null;
    }
    dbPollInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (sessionScopeId === acceptedSessionIdRef.current) return;
    acceptedSessionIdRef.current = sessionScopeId;
    reasoningSegmentClosedRef.current = false;
    // Reset the tail cursor: it is a per-session high-water mark, and carrying
    // it across a session switch would make the next read skip every row up to
    // the previous session's last id — silently dropping new messages.
    lastSyncedDbIdRef.current = 0;
    stopDbPolling();
  }, [sessionScopeId, stopDbPolling]);

  useEffect(() => {
    let disposed = false;

    const refreshFromDb = async (sessionId: string): Promise<void> => {
      if (
        !sessionId ||
        disposed ||
        dbPollInFlightRef.current ||
        acceptedSessionIdRef.current !== sessionId
      ) {
        return;
      }
      dbPollInFlightRef.current = true;
      const activeTurn = activeTurnRef.current ?? undefined;
      try {
        // CURSOR-SCOPED read. Passing the highest id we have already merged
        // keeps this O(new rows) instead of O(transcript): the poll runs every
        // 750ms and a full read measured ~180ms of blocking SQLite on a 21k-row
        // session (the stutter), versus ~0.2ms for the tail.
        const afterId = lastSyncedDbIdRef.current;
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
          afterId > 0 ? afterId : undefined,
        )) as DbHistoryItem[];
        if (
          disposed ||
          acceptedSessionIdRef.current !== sessionId ||
          items.length === 0
        ) {
          return;
        }
        const dbMessages = dbItemsToChatMessages(items);
        if (dbMessages.length === 0) return;
        // Capture the cursor BEFORE advancing it: the tail reconcile needs to
        // know where the already-merged prefix ends, and the incoming rows are
        // exactly what falls after it. Advancing first would make the merge
        // treat the new rows as already-settled prefix and drop them.
        const cursor = lastSyncedDbIdRef.current;
        const highest = highestDbId(dbMessages);
        setMessages((prev) => {
          if (prev.length === 0) return dbMessages;
          // The tail reconcile avoids re-deriving a merge key for every message
          // in the transcript (measured ~700ms on a 21k-row session).
          return reconcileTailAfterDbRefresh(prev, dbMessages, {
            activeTurn,
            lastSyncedDbId: cursor,
          });
        });
        // Advance only after handing the cursor to the merge.
        if (highest > lastSyncedDbIdRef.current) {
          lastSyncedDbIdRef.current = highest;
        }
      } catch {
        // Mid-stream DB refresh is opportunistic; final refresh still runs.
      } finally {
        dbPollInFlightRef.current = false;
      }
    };

    const startDbPolling = (sessionId: string): void => {
      stopDbPolling();
      void refreshFromDb(sessionId);
      dbPollRef.current = window.setInterval(() => {
        void refreshFromDb(sessionId);
      }, 750);
    };

    const cleanupSessionStarted = window.hermesAPI.onChatSessionStarted(
      (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId) || !sessionId) return;
        acceptedSessionIdRef.current = sessionId;
        setHermesSessionId(sessionId);
        startDbPolling(sessionId);
      },
    );

    const cleanupChunk = window.hermesAPI.onChatChunk((eventRunId, chunk) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      if (!activeTurnRef.current) return;
      // @lat: [[chat-commands#Delta chunks merge into the last same-kind row]]
      setMessages((prev) => {
        if (!chunk) return prev;
        // Merge into the LAST assistant bubble of the current turn, wherever
        // it sits — thinking/tool deltas interleave after the answer started
        // (a tool event closes the reasoning segment, forcing the next
        // thinking chunk into a NEW trailing row). Appending a fresh bubble
        // per chunk would remount the row and replay its entry animation —
        // a visible blink on every chunk.
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg.role === "user") break;
          if (isBubbleMessage(msg) && msg.role === "agent" && !msg.error) {
            return [
              ...prev.slice(0, i),
              {
                ...msg,
                content: msg.content + chunk,
                pending: true,
                turnId: msg.turnId || activeTurnRef.current?.turnId,
              },
              ...prev.slice(i + 1),
            ];
          }
        }
        if (!chunk.trim()) return prev;
        return [
          ...prev,
          {
            // Counter suffix keeps the key unique across chunks landing in
            // the same millisecond — a shared key would let React reuse the
            // element and REPLACE the accumulated text with just this chunk.
            id: `agent-ipc-${Date.now()}-${prev.length}`,
            role: "agent",
            content: chunk,
            pending: true,
            ...(activeTurnRef.current?.turnId
              ? { turnId: activeTurnRef.current.turnId }
              : {}),
          },
        ];
      });
    });

    const cleanupReasoning = window.hermesAPI.onChatReasoningChunk(
      (eventRunId, chunk) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        if (!chunk) return;
        const forceNewSegment = reasoningSegmentClosedRef.current;
        reasoningSegmentClosedRef.current = false;
        setMessages((prev) =>
          upsertLiveReasoningChunk(prev, chunk, Date.now(), forceNewSegment),
        );
      },
    );

    const cleanupDone = window.hermesAPI.onChatDone(
      async (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = false;
        stopDbPolling();
        const activeTurn = activeTurnRef.current;
        const acceptedSessionId = acceptedSessionIdRef.current;
        if (sessionId && acceptedSessionId && acceptedSessionId !== sessionId) {
          return;
        }
        if (sessionId && !acceptedSessionId && !activeTurn) {
          return;
        }
        if (sessionId) {
          acceptedSessionIdRef.current = sessionId;
          setHermesSessionId(sessionId);
          // A fresh session row was committed to state.db by the CLI; ask the
          // sidebar recent-sessions list to re-sync immediately so the new
          // conversation shows up without waiting for the next refresh tick.
          window.dispatchEvent(new Event("hermes-session-db-synced"));
        }
        if (!sessionId || activeTurn?.status === "failed") {
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          return;
        }
        try {
          const items = (await window.hermesAPI.getSessionMessages(
            sessionId,
          )) as DbHistoryItem[];
          const dbMessages = dbItemsToChatMessages(items);
          console.info("[gate-diag] legacy chat-done", {
            dbMessages: dbMessages.length,
            lastRoles: dbMessages
              .slice(-4)
              .map((m) =>
                "kind" in m ? m.kind : `${m.role}(${String(m.content).length})`,
              ),
          });
          if (dbMessages.length > 0) {
            setMessages((prev) =>
              reconcileAfterDbRefresh(prev, dbMessages, { activeTurn }),
            );
          }
          if (activeTurn) activeTurn.status = "completed";
        } catch {
          // Merge is a UX nicety; do not break chat completion on failure.
        } finally {
          setToolProgress(null);
          setIsLoading(false);
          if (activeTurnRef.current === activeTurn) {
            activeTurnRef.current = null;
          }
        }
      },
    );

    const cleanupError = window.hermesAPI.onChatError((eventRunId, error) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      reasoningSegmentClosedRef.current = false;
      stopDbPolling();
      const activeTurn = activeTurnRef.current;
      if (!activeTurn) return;
      activeTurn.status = "failed";
      setMessages((prev) => markActiveTurnFailed(prev, error, activeTurn));
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupClarify = window.hermesAPI.onClarifyRequest(
      (eventRunId, req) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = true;
        setToolProgress(null);
        setIsLoading(true);
        setMessages((prev) => {
          if (
            prev.some(
              (m) => m.kind === "clarify" && m.requestId === req.requestId,
            )
          ) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `clarify-${req.requestId}`,
              kind: "clarify",
              role: "agent",
              requestId: req.requestId,
              question: req.question,
              choices: Array.isArray(req.choices) ? req.choices : [],
            },
          ];
        });
      },
    );

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress(
      (eventRunId, tool) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        setToolProgress(null);
        if (!tool.trim()) return;
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) =>
          upsertLiveToolEvent(prev, liveToolEventFromProgress(tool)),
        );

        // Also check progress text for URLs, but only if it's a web tool
        const toolEventName =
          liveToolEventFromProgress(tool).name.toLowerCase();
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEventName);

        if (isWebTool) {
          const urlMatch = tool.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const event = new CustomEvent("web-preview:navigate", {
              detail: urlMatch[0],
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupToolEvent = window.hermesAPI.onChatToolEvent(
      (eventRunId, toolEvent) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        setToolProgress(null);
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) => upsertLiveToolEvent(prev, toolEvent));

        // Auto-open webview if the agent is using a browser/web tool to navigate
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEvent.name.toLowerCase());
        if (isWebTool) {
          const textToSearch = `${toolEvent.preview || ""} ${toolEvent.result || ""}`;
          const urlMatch = textToSearch.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const url = urlMatch[0];
            const event = new CustomEvent("web-preview:navigate", {
              detail: url,
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupUsage = window.hermesAPI.onChatUsage((eventRunId, u) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        contextTokens: u.promptTokens || prev?.contextTokens,
        cacheReadTokens: u.cacheReadTokens ?? prev?.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens ?? prev?.cacheWriteTokens,
      }));
    });

    return () => {
      disposed = true;
      stopDbPolling();
      cleanupSessionStarted();
      cleanupChunk();
      cleanupReasoning();
      cleanupDone();
      cleanupError();
      cleanupClarify();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupUsage();
    };
  }, [
    runId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
    stopDbPolling,
  ]);
}
