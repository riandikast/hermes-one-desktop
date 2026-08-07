import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Chat from "../Chat/Chat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import {
  type ChatRun,
  mintRun,
  patchRun,
  isScratchRun,
  openSessionRunTransition,
  selectProfileRunTransition,
  findRunBySession,
  cycleRunId,
  runIdAtOrdinal,
  loadingSessionIds as deriveLoadingSessionIds,
} from "./chatRuns";
import { ActiveSessionsBar } from "./ActiveSessionsBar";
import { StatusBar } from "./StatusBar";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import ProfileSwitcher from "./ProfileSwitcher";
import SidebarRecentSessions, {
  SHOW_SUBAGENT_RUNS_KEY,
} from "./SidebarRecentSessions";
import Memory from "../Memory/Memory";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import { FileViewer } from "../Chat/FileViewer";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import Kanban from "../Kanban/Kanban";
import KnowledgeScreen from "../Knowledge/KnowledgeScreen";
import Usage from "../Usage/Usage";
import { CommandScreen } from "../Command/CommandScreen";
import Capabilities from "../Capabilities/Capabilities";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import {
  Compass,
  Settings as SettingsIcon,
  Brain,
  Signal,
  Building,
  KeyRound,
  Timer,
  BookOpen,
  Terminal,
  Kanban as KanbanIcon,
  Download,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ChevronUp,
  ChevronDown,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { BarChart3 } from "lucide-react";
import { useI18n } from "../../components/useI18n";

type View =
  | "chat"
  | "file"
  | "capabilities"
  | "agents"
  | "office"
  | "providers"
  | "memory"
  | "schedules"
  | "knowledge"
  | "commands"
  | "kanban"
  | "gateway"
  | "usage";

const PINNED_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "capabilities", icon: Compass, labelKey: "navigation.tools" },
  { view: "office", icon: Building, labelKey: "navigation.office" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "knowledge", icon: BookOpen, labelKey: "navigation.knowledge" },
  { view: "commands", icon: Terminal, labelKey: "navigation.commands" },
];

const FOOTER_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
  { view: "usage", icon: BarChart3, labelKey: "navigation.usage" },
];

const SIDEBAR_COLLAPSED_KEY = "hermes.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "hermes.sidebar.width";
const TOP_MENU_COLLAPSED_KEY = "hermes.topmenu.collapsed";
const SIDEBAR_SCROLLBAR_HIDE_MS = 700;
const PINNED_NAV_COLLAPSED_KEY = "hermes.sidebar.pinnedCollapsed";

/** Sidebar drag-resize bounds: current 250px is the max; can only be narrowed. */
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 250;

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const { openSettings } = useSettingsModal();
  const [view, setView] = useState<View>("chat");
  const [activeProfile, setActiveProfile] = useState("default");
  const [runs, setRuns] = useState<ChatRun[]>(() => [mintRun("default")]);
  const [activeRunId, setActiveRunId] = useState<string>(() => runs[0].runId);
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(
    null,
  );
  const resumingRef = useRef<Set<string>>(new Set());
  const sidebarChatScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollbarHideRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [sidebarScrollbar, setSidebarScrollbar] = useState({
    visible: false,
    scrollable: false,
    top: 0,
    height: 0,
  });

  const currentSessionId =
    runs.find((r) => r.runId === activeRunId)?.sessionId ?? null;

  const loadingSessionIds = useMemo(
    () => deriveLoadingSessionIds(runs),
    [runs],
  );

  const updateSidebarScrollbar = useCallback((visible: boolean) => {
    const root = sidebarChatScrollRef.current;
    if (!root) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const scrollable = root.scrollHeight > root.clientHeight + 1;
    if (!scrollable) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const trackHeight = root.clientHeight;
    const thumbHeight = Math.max(
      32,
      Math.round((root.clientHeight / root.scrollHeight) * trackHeight),
    );
    const maxTop = Math.max(0, trackHeight - thumbHeight);
    const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
    const top = Math.round((root.scrollTop / maxScroll) * maxTop);

    setSidebarScrollbar((prev) => {
      const next = { visible, scrollable, top, height: thumbHeight };
      return prev.visible === next.visible &&
        prev.scrollable === next.scrollable &&
        prev.top === next.top &&
        prev.height === next.height
        ? prev
        : next;
    });
  }, []);

  useEffect(() => {
    const root = sidebarChatScrollRef.current;
    if (!root) return;

    const showThenHide = (): void => {
      updateSidebarScrollbar(true);
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
      sidebarScrollbarHideRef.current = setTimeout(() => {
        updateSidebarScrollbar(false);
      }, SIDEBAR_SCROLLBAR_HIDE_MS);
    };

    const updateHidden = (): void => updateSidebarScrollbar(false);
    root.addEventListener("scroll", showThenHide, { passive: true });
    window.addEventListener("resize", updateHidden);
    const observer = new ResizeObserver(updateHidden);
    observer.observe(root);

    updateHidden();
    return () => {
      root.removeEventListener("scroll", showThenHide);
      window.removeEventListener("resize", updateHidden);
      observer.disconnect();
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
    };
  }, [updateSidebarScrollbar]);

  const [profileAppearance, setProfileAppearance] = useState<
    Record<string, { color?: string | null; avatar?: string | null }>
  >({});
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, { color?: string; avatar?: string | null }> =
          {};
        for (const p of list) map[p.id] = { color: p.color, avatar: p.avatar };
        setProfileAppearance(map);
      })
      .catch(() => {
        /* keep last-known appearance */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, view]);
  const getAppearance = useCallback(
    (profile: string) => profileAppearance[profile] ?? {},
    [profileAppearance],
  );

  const handleRunLoading = useCallback((runId: string, loading: boolean) => {
    setRuns((prev) => patchRun(prev, runId, { loading }));
  }, []);
  const handleRunSessionId = useCallback(
    (runId: string, sessionId: string | null) => {
      setRuns((prev) => patchRun(prev, runId, { sessionId }));
    },
    [],
  );
  const handleRunTitle = useCallback((runId: string, title: string) => {
    setRuns((prev) => patchRun(prev, runId, { title }));
  }, []);

  // A sidebar rename updates the DB and the sidebar list, but the top-bar tab
  // label comes from this component's runs state — patch the matching run by
  // session id so the tab reflects the new title immediately.
  useEffect(() => {
    const handleTitleChanged = (e: Event): void => {
      const { sessionId, title } = (
        e as CustomEvent<{ sessionId: string; title: string }>
      ).detail;
      setRuns((prev) =>
        prev.map((r) => (r.sessionId === sessionId ? { ...r, title } : r)),
      );
    };
    window.addEventListener("hermes-session-title-changed", handleTitleChanged);
    return () =>
      window.removeEventListener(
        "hermes-session-title-changed",
        handleTitleChanged,
      );
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Drag-resizable sidebar width. Persisted; only narrows from the current
  // default (250px) down to a comfortable minimum.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      const parsed = raw ? Number(raw) : SIDEBAR_WIDTH_MAX;
      return Number.isFinite(parsed)
        ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, parsed))
        : SIDEBAR_WIDTH_MAX;
    } catch {
      return SIDEBAR_WIDTH_MAX;
    }
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number }>({
    startX: 0,
    startWidth: SIDEBAR_WIDTH_MAX,
  });
  // Subagent-runs filter state, mirrored from SidebarRecentSessions so the
  // footer's Bot button can show the active state.
  const [subagentRunsVisible, setSubagentRunsVisible] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem(SHOW_SUBAGENT_RUNS_KEY) === "true";
      } catch {
        return false;
      }
    },
  );

  useEffect(() => {
    const onChange = (e: Event): void => {
      setSubagentRunsVisible((e as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener("hermes-sidebar-subagents-changed", onChange);
    return () =>
      window.removeEventListener("hermes-sidebar-subagents-changed", onChange);
  }, []);

  const onSidebarResizeStart = (
    e: React.PointerEvent<HTMLDivElement>,
  ): void => {
    sidebarResizeRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
    setSidebarResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSidebarResizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!sidebarResizing) return;
    const { startX, startWidth } = sidebarResizeRef.current;
    const next = Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, startWidth + (e.clientX - startX)),
    );
    setSidebarWidth(next);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const onSidebarResizeEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    setSidebarResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // NEW: Top menu collapse state
  const [topMenuCollapsed, setTopMenuCollapsed] = useState(() => {
    try {
      return localStorage.getItem(TOP_MENU_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  // NEW: Toggle top menu collapse
  const toggleTopMenuCollapsed = useCallback(() => {
    setTopMenuCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TOP_MENU_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [pinnedNavCollapsed, setPinnedNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PINNED_NAV_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const togglePinnedNavCollapsed = useCallback(() => {
    setPinnedNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PINNED_NAV_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  const [remoteMode, setRemoteMode] = useState(false);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const VIEW_LABEL_KEYS: Record<View, string> = useMemo(
    () => ({
      chat: "navigation.chat",
      file: "navigation.file",
      capabilities: "navigation.tools",
      office: "navigation.office",
      kanban: "navigation.kanban",
      schedules: "navigation.schedules",
      knowledge: "navigation.knowledge",
      commands: "navigation.commands",
      providers: "navigation.providers",
      gateway: "navigation.gateway",
      memory: "navigation.memory",
      usage: "navigation.usage",
      agents: "navigation.agents",
    }),
    [],
  );

  const goTo = useCallback(
    (v: View) => {
      setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
      if (v === "chat") {
        // Never pick a run here: every caller (resume session, new chat,
        // profile switch) activates the EXACT run it wants before calling
        // goTo("chat"), and no navigation event dispatches "chat". Picking
        // "the first chat run" here overrode that activation with the
        // leftmost session tab (reported bug).
        setView("chat");
        return;
      }

      const existing = runs.find((r) => r.targetView === v);
      if (existing) {
        setActiveRunId(existing.runId);
        setView(v);
      } else {
        const labelKey = VIEW_LABEL_KEYS[v];
        const viewRun: ChatRun = {
          runId: `view-${v}-${Date.now()}`,
          profile: activeProfile,
          sessionId: null,
          loading: false,
          title: labelKey ? t(labelKey) : v,
          targetView: v,
        };
        setRuns((prev) => [...prev, viewRun]);
        setActiveRunId(viewRun.runId);
        setView(v);
      }
    },
    [runs, activeProfile, t, VIEW_LABEL_KEYS],
  );

  useEffect(() => {
    const handleNavigation = (e: Event): void => {
      const targetView = (e as CustomEvent<View>).detail;
      if (targetView) goTo(targetView);
    };
    window.addEventListener("navigation:goto", handleNavigation);
    return () =>
      window.removeEventListener("navigation:goto", handleNavigation);
  }, [goTo]);

  // Open a file as a STANDALONE top-strip tab (VS Code style): one tab per
  // open file, like a session tab — not a child of the chat page. Clicking a
  // file in any worktree sidebar dispatches this event; the content pane then
  // shows the file's editor (all open files stay mounted so unsaved edits
  // survive tab switching). `line` (1-based) jumps the editor to that line.
  const handleOpenFile = useCallback(
    (filePath: string, line?: number) => {
      const existing = runs.find((r) => r.filePath === filePath);
      if (existing) {
        setActiveRunId(existing.runId);
        setActiveProfile(existing.profile);
        if (line) {
          setRuns((prev) => patchRun(prev, existing.runId, { fileLine: line }));
        }
      } else {
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        const fileRun: ChatRun = {
          runId: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          profile: activeProfile,
          sessionId: null,
          loading: false,
          title: fileName,
          targetView: "file",
          filePath,
          ...(line ? { fileLine: line } : {}),
        };
        setRuns((prev) => [...prev, fileRun]);
        setActiveRunId(fileRun.runId);
        setActiveProfile(activeProfile);
      }
      setVisitedViews((prev) =>
        prev.has("file") ? prev : new Set(prev).add("file"),
      );
      setView("file");
    },
    [runs, activeProfile],
  );

  useEffect(() => {
    const handleOpenFileEvent = (e: Event): void => {
      const detail = (
        e as CustomEvent<string | { path: string; line?: number }>
      ).detail;
      if (typeof detail === "string") {
        // Legacy payload: the worktree sidebar dispatches a bare path.
        handleOpenFile(detail);
      } else if (detail && typeof detail === "object" && detail.path) {
        // Find-in-Files payload: path + optional 1-based line.
        handleOpenFile(detail.path, detail.line);
      }
    };
    window.addEventListener("hermes-open-file", handleOpenFileEvent);
    return () =>
      window.removeEventListener("hermes-open-file", handleOpenFileEvent);
  }, [handleOpenFile]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(undefined, { profile: activeProfile });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openSettings, activeProfile]);

  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive);
        if (active && active.id !== "default") {
          setActiveProfile(active.id);
          setRuns((prev) =>
            prev.length === 1 && !prev[0].sessionId && !prev[0].loading
              ? [{ ...prev[0], profile: active.id }]
              : prev,
          );
        }
      })
      .catch(() => {
        /* fall back to the default profile */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateState("available");
      setUpdateVersion(info.version);
      setUpdateError(null);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setUpdateState("downloading");
        setUpdatePercent(info.percent);
        setUpdateError(null);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdatePercent(null);
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    } else if (updateState === "available" || updateState === "error") {
      setUpdateState("downloading");
      setUpdatePercent(null);
      setUpdateError(null);
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    }
  }

  const updateButtonTitle =
    updateError ??
    (updateState === "available" && updateVersion
      ? t("common.updateAvailable", { version: updateVersion })
      : updateState === "downloading"
        ? updatePercent === null
          ? t("common.downloading", { percent: 0 })
          : t("common.downloading", { percent: updatePercent })
        : updateState === "ready"
          ? t("common.restartToUpdate")
          : updateState === "error"
            ? t("common.updateFailed")
            : undefined);

  const handleNewChat = useCallback(() => {
    const active = runs.find((r) => r.runId === activeRunId);
    if (
      active &&
      !active.sessionId &&
      !active.loading &&
      !active.title &&
      !active.targetView
    ) {
      setView("chat");
      return;
    }
    const run = mintRun(activeProfile);
    setRuns((prev) => [...prev, run]);
    setActiveRunId(run.runId);
    setView("chat");
  }, [runs, activeRunId, activeProfile]);

  const handleNewChatInProject = useCallback(
    (folderPath: string) => {
      const run = mintRun(activeProfile, undefined, [folderPath]);
      setRuns((prev) => [...prev, run]);
      setActiveRunId(run.runId);
      goTo("chat");
    },
    [activeProfile, goTo],
  );

  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      setSessionsModalOpen(true);
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewChat]);

  useEffect(() => {
    if (!sessionsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSessionsModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionsModalOpen]);

  const handleSelectProfile = useCallback(
    (name: string) => {
      setActiveProfile(name);
      const next = selectProfileRunTransition(runs, activeRunId, name);
      setRuns(next.runs);
      setActiveRunId(next.activeRunId);
    },
    [runs, activeRunId],
  );

  const handleChatWithProfile = useCallback(
    (name: string) => {
      setActiveProfile(name);
      const active = runs.find((r) => r.runId === activeRunId);
      if (active && isScratchRun(active)) {
        setRuns((prev) =>
          prev.map((r) =>
            r.runId === active.runId ? { ...r, profile: name } : r,
          ),
        );
      } else {
        const run = mintRun(name);
        setRuns((prev) => [...prev, run]);
        setActiveRunId(run.runId);
      }
      goTo("chat");
    },
    [runs, activeRunId, goTo],
  );

  const handleActivateRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.runId === runId);
      if (!run) return;
      setActiveRunId(runId);
      setActiveProfile(run.profile);
      if (run.targetView) {
        const tv = run.targetView as View;
        setVisitedViews((prev) =>
          prev.has(tv) ? prev : new Set(prev).add(tv),
        );
        setView(tv);
      } else {
        setView("chat");
      }
    },
    [runs],
  );

  const handleCloseRun = useCallback(
    (runId: string) => {
      window.hermesAPI.abortChat(runId);
      const idx = runs.findIndex((r) => r.runId === runId);
      const remaining = runs.filter((r) => r.runId !== runId);
      if (remaining.length === 0) {
        const fresh = mintRun(activeProfile);
        setRuns([fresh]);
        setActiveRunId(fresh.runId);
        setView("chat");
        return;
      }
      setRuns(remaining);
      if (runId === activeRunId) {
        const neighbour = remaining[Math.min(idx, remaining.length - 1)];
        setActiveRunId(neighbour.runId);
        setActiveProfile(neighbour.profile);
        if (neighbour.targetView) {
          const tv = neighbour.targetView as View;
          setVisitedViews((prev) =>
            prev.has(tv) ? prev : new Set(prev).add(tv),
          );
          setView(tv);
        } else {
          setView("chat");
        }
      }
    },
    [runs, activeRunId, activeProfile],
  );

  const handleCloseOthers = useCallback(
    (runId: string) => {
      const keep = runs.find((r) => r.runId === runId);
      if (!keep) return;
      for (const r of runs) {
        if (r.runId !== runId) window.hermesAPI.abortChat(r.runId);
      }
      setRuns([keep]);
      setActiveRunId(keep.runId);
      setActiveProfile(keep.profile);
    },
    [runs],
  );

  const handleCloseToRight = useCallback(
    (runId: string) => {
      const idx = runs.findIndex((r) => r.runId === runId);
      if (idx < 0) return;
      const keep = runs.slice(0, idx + 1);
      const drop = runs.slice(idx + 1);
      for (const r of drop) window.hermesAPI.abortChat(r.runId);
      setRuns(keep);
      if (!keep.some((r) => r.runId === activeRunId)) {
        setActiveRunId(runId);
        setActiveProfile(keep[keep.length - 1].profile);
      }
    },
    [runs, activeRunId],
  );

  const handleReorderRuns = useCallback(
    (sourceRunId: string, targetRunId: string) => {
      setRuns((prev) => {
        const fromIdx = prev.findIndex((r) => r.runId === sourceRunId);
        const toIdx = prev.findIndex((r) => r.runId === targetRunId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      return (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t.isContentEditable
      );
    };
    const handleKey = (e: KeyboardEvent): void => {
      const primary = e.metaKey || e.ctrlKey;
      let target: string | null = null;
      let matched = false;
      if (primary && !e.shiftKey && !e.altKey && e.code === "KeyW") {
        e.preventDefault();
        handleCloseRun(activeRunId);
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Tab") {
        matched = true;
        target = cycleRunId(runs, activeRunId, e.shiftKey ? -1 : 1);
      } else if (
        primary &&
        e.shiftKey &&
        !e.altKey &&
        (e.code === "BracketRight" || e.code === "BracketLeft")
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "BracketRight" ? 1 : -1,
        );
      } else if (
        primary &&
        (e.code === "ArrowRight" || e.code === "ArrowLeft") &&
        ((e.altKey && !e.shiftKey) ||
          (e.shiftKey && !e.altKey && !isEditable(e.target)))
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "ArrowRight" ? 1 : -1,
        );
      } else if (primary && !e.shiftKey && !e.altKey) {
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (digit) {
          matched = true;
          target = runIdAtOrdinal(runs, Number(digit[1]));
        }
      }
      if (!matched) return;
      e.preventDefault();
      if (target) handleActivateRun(target);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runs, activeRunId, handleActivateRun, handleCloseRun]);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const live = findRunBySession(runs, sessionId);
      if (live) {
        handleActivateRun(live.runId);
        goTo("chat");
        return;
      }
      if (resumingRef.current.has(sessionId)) return;
      resumingRef.current.add(sessionId);
      setResumingSessionId(sessionId);
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        const run = mintRun(activeProfile, dbItemsToChatMessages(items));
        run.sessionId = sessionId;
        // Restore the persisted title (possibly user-renamed) so the tab
        // doesn't fall back to the auto-derived first-message title.
        try {
          const cached = await window.hermesAPI.listCachedSessions(200);
          const found = cached.find((s) => s.id === sessionId);
          if (found?.title) run.title = found.title;
        } catch {
          /* title is best-effort */
        }
        setRuns(
          (prev) => openSessionRunTransition(prev, activeRunId, run).runs,
        );
        setActiveRunId(run.runId);
        goTo("chat");
      } finally {
        resumingRef.current.delete(sessionId);
        setResumingSessionId(null);
      }
    },
    [runs, activeRunId, handleActivateRun, activeProfile, goTo],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  }, []);

  const sidebarToggleLabel = sidebarCollapsed
    ? t("navigation.expandSidebar")
    : t("navigation.collapseSidebar");

  // NEW: Top menu toggle label
  const topMenuToggleLabel = topMenuCollapsed
    ? t("navigation.expandTopMenu")
    : t("navigation.collapseTopMenu");

  return (
    <div className="layout-shell">
      <div className={`layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside
          className={`sidebar ${sidebarResizing ? "sidebar--resizing" : ""}`}
          // Collapsed width comes from the .sidebar-collapsed CSS rule; only
          // apply the inline width when expanded, else it overrides the 64px.
          style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
        >
          {!sidebarCollapsed && (
            <div
              className="sidebar-resize-handle"
              onPointerDown={onSidebarResizeStart}
              onPointerMove={onSidebarResizeMove}
              onPointerUp={onSidebarResizeEnd}
              aria-label="Resize sidebar"
              title="Drag to resize"
            />
          )}
          <div className="sidebar-brand">
            <button
              className="sidebar-collapse-toggle"
              type="button"
              onClick={toggleSidebar}
              title={sidebarToggleLabel}
              aria-label={sidebarToggleLabel}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <span className="sidebar-collapse-swap">
                  <span className="sidebar-collapse-mark" aria-hidden="true" />
                  <PanelLeftOpen
                    size={16}
                    className="sidebar-collapse-expand-icon"
                  />
                </span>
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          </div>

          <nav className="sidebar-nav sidebar-nav-pinned">
            <div className="sidebar-new-chat-row">
              <button
                className={`sidebar-nav-item sidebar-new-chat ${
                  view === "chat" && currentSessionId === null ? "active" : ""
                }`}
                onClick={handleNewChat}
                title={t("navigation.newChat")}
                aria-label={t("navigation.newChat")}
              >
                <Plus size={16} />
                <span className="sidebar-nav-label">
                  {t("navigation.newChat")}
                </span>
              </button>
              <button
                type="button"
                className={`sidebar-pinned-toggle ${pinnedNavCollapsed ? "collapsed" : ""}`}
                onClick={togglePinnedNavCollapsed}
                title={
                  pinnedNavCollapsed
                    ? "Expand navigation menu"
                    : "Collapse navigation menu"
                }
                aria-label={
                  pinnedNavCollapsed
                    ? "Expand navigation menu"
                    : "Collapse navigation menu"
                }
              >
                <ChevronDown
                  size={14}
                  className={`sidebar-pinned-chevron ${pinnedNavCollapsed ? "collapsed" : ""}`}
                />
              </button>
            </div>
            <div
              className={`sidebar-pinned-items ${pinnedNavCollapsed ? "sidebar-pinned-items--collapsed" : ""}`}
            >
              {PINNED_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => {
                return (
                  <button
                    key={v}
                    className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                    onClick={() => goTo(v)}
                    title={t(labelKey)}
                    aria-label={t(labelKey)}
                  >
                    <Icon size={16} />
                    <span className="sidebar-nav-label">{t(labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="sidebar-chat-section">
            <div className="sidebar-nav-sessions">
              <div className="sidebar-chat-scroll" ref={sidebarChatScrollRef}>
                <SidebarRecentSessions
                  open={!sidebarCollapsed}
                  activeProfile={activeProfile}
                  currentSessionId={currentSessionId}
                  loadingSessionIds={loadingSessionIds}
                  resumingSessionId={resumingSessionId}
                  onSelect={handleResumeSession}
                  onSessionDeleted={(id) => {
                    if (id === currentSessionId) handleNewChat();
                  }}
                  onNewChatInProject={handleNewChatInProject}
                  scrollRootRef={sidebarChatScrollRef}
                />
              </div>
              {sidebarScrollbar.scrollable && (
                <div
                  className={`sidebar-chat-scrollbar ${
                    sidebarScrollbar.visible ? "visible" : ""
                  }`}
                  aria-hidden="true"
                >
                  <div
                    className="sidebar-chat-scrollbar-thumb"
                    style={{
                      height: sidebarScrollbar.height,
                      transform: `translateY(${sidebarScrollbar.top}px)`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-footer">
            {updateState && (
              <button
                className={`sidebar-update-btn ${
                  updateState === "error" ? "error" : ""
                }`}
                onClick={handleUpdate}
                disabled={updateState === "downloading"}
                title={updateButtonTitle}
                aria-label={updateButtonTitle}
              >
                <Download size={13} />
                {updateState === "available" && (
                  <span>
                    {updateVersion
                      ? t("common.updateAvailable", { version: updateVersion })
                      : t("common.updateAvailable", { version: "" })}
                  </span>
                )}
                {updateState === "downloading" && (
                  <span>
                    {t("common.downloading", { percent: updatePercent ?? 0 })}
                  </span>
                )}
                {updateState === "ready" && (
                  <span>{t("common.restartToUpdate")}</span>
                )}
                {updateState === "error" && (
                  <span>{t("common.updateFailed")}</span>
                )}
              </button>
            )}
            <div className="sidebar-footer-menu" aria-label="Workspace tools">
              <div className="sidebar-footer-actions-row">
                <button
                  type="button"
                  className="sidebar-footer-action sidebar-settings-trigger"
                  onClick={() =>
                    openSettings(undefined, { profile: activeProfile })
                  }
                  aria-label={t("navigation.settings")}
                  data-tooltip={t("navigation.settings")}
                >
                  <SettingsIcon size={16} />
                </button>
                <button
                  type="button"
                  className={`sidebar-footer-action sidebar-subagent-trigger ${
                    subagentRunsVisible ? "active" : ""
                  }`}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("hermes-sidebar-toggle-subagents"),
                    )
                  }
                  aria-label="Show subagent runs"
                  data-tooltip={
                    subagentRunsVisible
                      ? "Hide subagent runs"
                      : "Show subagent runs"
                  }
                >
                  <Bot size={16} />
                </button>
              </div>
              <div className="sidebar-footer-flyout">
                {FOOTER_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
                  <button
                    key={v}
                    className={`sidebar-footer-action ${view === v ? "active" : ""}`}
                    onClick={() => goTo(v)}
                    aria-label={t(labelKey)}
                    data-tooltip={t(labelKey)}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            </div>
            <ProfileSwitcher
              activeProfile={activeProfile}
              onSwitch={handleSelectProfile}
              onManage={() => goTo("agents")}
              compact={sidebarCollapsed}
            />
          </div>
        </aside>

        <main className="content">
          {/* Top menu wrapper with collapse toggle */}
          <div className="top-menu-wrapper">
            <div
              className={`top-menu-container ${topMenuCollapsed ? "top-menu-collapsed" : ""}`}
            >
              <ActiveSessionsBar
                runs={runs}
                activeRunId={activeRunId}
                onSelect={handleActivateRun}
                onClose={handleCloseRun}
                onCloseOthers={handleCloseOthers}
                onCloseToRight={handleCloseToRight}
                onReorder={handleReorderRuns}
                onNew={handleNewChat}
                getAppearance={getAppearance}
              />
              <button
                className="top-menu-collapse-toggle"
                type="button"
                onClick={toggleTopMenuCollapsed}
                title={topMenuToggleLabel}
                aria-label={topMenuToggleLabel}
                aria-expanded={!topMenuCollapsed}
              >
                {topMenuCollapsed ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronUp size={16} />
                )}
              </button>
            </div>
          </div>

          {verifyWarning && onReinstall && onDismissVerifyWarning && (
            <VerifyWarningBanner
              onReinstall={onReinstall}
              onDismiss={onDismissVerifyWarning}
            />
          )}
          <div style={paneStyle("chat")}>
            {runs.map((run) => (
              <div
                key={run.runId}
                style={{
                  display:
                    view === "chat" && run.runId === activeRunId
                      ? "flex"
                      : "none",
                  flex: 1,
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <Chat
                  runId={run.runId}
                  initialMessages={run.seed}
                  initialSessionId={run.sessionId}
                  initialTitle={run.title}
                  initialContextFolders={run.initialContextFolders}
                  active={run.runId === activeRunId}
                  profile={run.profile}
                  onNewChat={handleNewChat}
                  onOpenDiagnose={(section?: string) =>
                    openSettings(section, { profile: run.profile })
                  }
                  onLoadingChange={handleRunLoading}
                  onSessionIdChange={handleRunSessionId}
                  onTitleChange={handleRunTitle}
                  agentAppearance={getAppearance(run.profile)}
                />
              </div>
            ))}
          </div>

          {visitedViews.has("file") && (
            <div style={paneStyle("file")}>
              {runs
                .filter((r) => r.filePath)
                .map((run) => (
                  <div
                    key={run.runId}
                    style={{
                      display:
                        view === "file" && run.runId === activeRunId
                          ? "flex"
                          : "none",
                      flex: 1,
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <FileViewer
                      filePath={run.filePath!}
                      active={run.runId === activeRunId}
                      initialLine={run.fileLine}
                      onClose={() => handleCloseRun(run.runId)}
                    />
                  </div>
                ))}
            </div>
          )}

          {sessionsModalOpen && (
            <div
              className="models-modal-overlay"
              onClick={() => setSessionsModalOpen(false)}
            >
              <div
                className="sessions-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <Sessions
                  onResumeSession={(id) => {
                    setSessionsModalOpen(false);
                    void handleResumeSession(id);
                  }}
                  onNewChat={() => {
                    setSessionsModalOpen(false);
                    handleNewChat();
                  }}
                  currentSessionId={currentSessionId}
                  visible={sessionsModalOpen}
                />
              </div>
            </div>
          )}

          {visitedViews.has("capabilities") && (
            <div style={paneStyle("capabilities")}>
              <Capabilities
                profile={activeProfile}
                visible={view === "capabilities"}
              />
            </div>
          )}

          {visitedViews.has("agents") && (
            <div style={paneStyle("agents")}>
              {remoteMode ? (
                <RemoteNotice feature="Profiles" />
              ) : (
                <Agents
                  activeProfile={activeProfile}
                  onSelectProfile={handleSelectProfile}
                  onChatWith={handleChatWithProfile}
                />
              )}
            </div>
          )}

          {visitedViews.has("office") && (
            <div style={paneStyle("office")}>
              <Office profile={activeProfile} visible={view === "office"} />
            </div>
          )}

          {visitedViews.has("providers") && (
            <div style={paneStyle("providers")}>
              {remoteMode ? (
                <RemoteNotice feature="Providers" />
              ) : (
                <Providers
                  profile={activeProfile}
                  visible={view === "providers"}
                />
              )}
            </div>
          )}

          {visitedViews.has("memory") && (
            <div style={paneStyle("memory")}>
              {remoteMode ? (
                <RemoteNotice feature="Memory" />
              ) : (
                <Memory profile={activeProfile} />
              )}
            </div>
          )}

          {visitedViews.has("schedules") && (
            <div style={paneStyle("schedules")}>
              <Schedules profile={activeProfile} />
            </div>
          )}

          {visitedViews.has("knowledge") && (
            <div style={paneStyle("knowledge")}>
              <KnowledgeScreen />
            </div>
          )}

          {visitedViews.has("commands") && (
            <div style={paneStyle("commands")}>
              <CommandScreen />
            </div>
          )}

          {visitedViews.has("kanban") && (
            <div style={paneStyle("kanban")}>
              {remoteMode ? (
                <RemoteNotice feature="Kanban" />
              ) : (
                <Kanban profile={activeProfile} visible={view === "kanban"} />
              )}
            </div>
          )}

          {visitedViews.has("gateway") && (
            <div style={paneStyle("gateway")}>
              {remoteMode ? (
                <RemoteNotice feature="Gateway" />
              ) : (
                <Gateway profile={activeProfile} />
              )}
            </div>
          )}

          {visitedViews.has("usage") && (
            <div style={paneStyle("usage")}>
              <Usage />
            </div>
          )}
        </main>
      </div>
      <StatusBar activeProfile={activeProfile} />
    </div>
  );
}

export default Layout;
