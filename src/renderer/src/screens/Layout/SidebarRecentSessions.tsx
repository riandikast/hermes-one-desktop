import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../components/useI18n";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  Loader,
  MoreHorizontal,
  Pin,
  X,
  Search,
  Bot,
  Plus,
} from "../../assets/icons";
import { Bell, BellOff, Users } from "lucide-react";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { CreateGroupChatModal } from "../../components/CreateGroupChatModal";
import SidebarSessionMenu, {
  type SidebarMenuProject,
  type SidebarMenuTarget,
} from "./SidebarSessionMenu";
import {
  getProjectAlias,
  projectDisplayName,
  setProjectAlias,
  useProjectAliases,
} from "./projectAliases";

interface RecentSession {
  id: string;
  title: string;
  contextFolder?: string | null;
  contextFolders?: string[];
  /** Set for subagent/branch runs — hidden from the default list. */
  parentSessionId?: string | null;
}

interface GroupChatRecord {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: number;
  lastMessage?: string;
}

const GROUP_CHATS_STORAGE_KEY = "hermes.bots.groupChats";

function loadStoredGroupChats(): GroupChatRecord[] {
  try {
    const raw = localStorage.getItem(GROUP_CHATS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredGroupChats(records: GroupChatRecord[]): void {
  try {
    localStorage.setItem(GROUP_CHATS_STORAGE_KEY, JSON.stringify(records));
  } catch {}
}

// ChatGPT-style paged conversation list under the pinned app navigation.
export const RECENT_SESSIONS_PAGE_SIZE = 30;

// Re-sync cadence while the list is visible. Deliberately slower than the
// Sessions screen (30s) — the sidebar is always on screen, so this interval
// runs for the whole app lifetime when the section is expanded.
const RECENT_REFRESH_MS = 60_000;

// Minimum gap between event-driven refreshes (focus, session switch) so a
// burst of focus/blur events doesn't hammer state.db.
const REFRESH_THROTTLE_MS = 5_000;
const INFINITE_SCROLL_THRESHOLD_PX = 180;
const PROJECTS_OPEN_KEY = "hermes.sidebar.projectsOpen";
const CHATS_OPEN_KEY = "hermes.sidebar.chatsOpen";
const FOLDERS_CLOSED_KEY = "hermes.sidebar.closedProjectFolders";
const PINNED_OPEN_KEY = "hermes.sidebar.pinnedOpen";
// Subagent runs (parentSessionId set) are filtered from the default list;
// the toggle reveals them so they stay deletable.
export const SHOW_SUBAGENT_RUNS_KEY = "hermes.sidebar.showSubagentRuns";
// Pinned session ids live in localStorage like the disclosure state — pinning
// is a desktop-only UI affordance, not part of the agent session schema.
const PINNED_IDS_KEY = "hermes.sidebar.pinnedSessions";

function readStoredPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storePinned(ids: Set<string>): void {
  try {
    localStorage.setItem(PINNED_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore persistence failures */
  }
}

function targetPathCount(
  path: string,
  chats: RecentSession[],
  pinned: RecentSession[],
  groups: Array<{ path: string; name: string; sessions: RecentSession[] }>,
): number {
  if (path === "__chats__") return chats.length;
  if (path === "__pinned__") return pinned.length;
  return groups.find((g) => g.path === path)?.sessions.length ?? 0;
}

function readStoredOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function readStoredBool(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "true";
  } catch {
    return defaultValue;
  }
}

function readStoredClosedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDERS_CLOSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storeClosedFolders(paths: Set<string>): void {
  try {
    localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify(Array.from(paths)));
  } catch {
    /* ignore persistence failures */
  }
}

function sameSessions(a: RecentSession[], b: RecentSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const folderA = (a[i].contextFolders?.[0] || a[i].contextFolder)?.trim() ?? null;
    const folderB = (b[i].contextFolders?.[0] || b[i].contextFolder)?.trim() ?? null;
    if (
      a[i].id !== b[i].id ||
      a[i].title !== b[i].title ||
      folderA !== folderB
    ) {
      return false;
    }
  }
  return true;
}

function groupSessionsByWorkspace(sessions: RecentSession[]): {
  projectGroups: Array<{
    path: string;
    name: string;
    sessions: RecentSession[];
  }>;
  chats: RecentSession[];
} {
  const projects = new Map<string, RecentSession[]>();
  const chats: RecentSession[] = [];

  for (const session of sessions) {
    const rawFolder = session.contextFolders?.[0] || session.contextFolder;
    const contextFolder = rawFolder?.trim();
    if (!contextFolder) {
      chats.push(session);
      continue;
    }
    const existing = projects.get(contextFolder);
    if (existing) existing.push(session);
    else projects.set(contextFolder, [session]);
  }

  return {
    projectGroups: Array.from(projects.entries()).map(([path, list]) => ({
      path,
      name: projectDisplayName(path),
      sessions: list,
    })),
    chats,
  };
}

/**
 * Recent-sessions list rendered under the "Sessions" nav item in the sidebar
 * (like ChatGPT's sidebar chat list). Owns its own data so Layout re-renders
 * (view switches, update banners, …) never trigger fetches, and `memo` keeps
 * it off the render hot path entirely.
 *
 * Fetch strategy, cheapest first:
 *  - on open: instant read from the sessions.json cache (no DB), then one
 *    sync against state.db to pick up sessions created since the last sync
 *  - while open: refresh on window focus and on a slow interval, throttled
 *  - closed (collapsed section or icon-only sidebar): zero work, renders null
 */
const SidebarRecentSessions = memo(function SidebarRecentSessions({
  open,
  activeProfile,
  currentSessionId,
  loadingSessionIds,
  resumingSessionId,
  onSelect,
  onSessionDeleted,
  onNewChatInProject,
  onChatWithBot,
  onOpenGroupChat,
  currentGroupChatId,
  searchOpen,
  onSearchOpenChange,
  scrollRootRef,
}: {
  open: boolean;
  /** Active profile — the list is per-profile, so switching forces a reload. */
  activeProfile: string;
  currentSessionId: string | null;
  /** Session ids of every run currently generating (multiple run at once). */
  loadingSessionIds: Set<string>;
  /** A session whose history is being fetched for resume (transient spinner). */
  resumingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** Notifies Layout when a row is deleted so it can leave a stale active chat. */
  onSessionDeleted?: (sessionId: string) => void;
  onNewChatInProject?: (folderPath: string) => void;
  onChatWithBot?: (profileName: string) => void;
  onOpenGroupChat?: (group: GroupChatRecord) => void;
  currentGroupChatId?: string | null;
  /** Scroll container owned by Layout; nearing its bottom loads the next page. */
  scrollRootRef: RefObject<HTMLDivElement | null>;
  /** Session search: when true, a filter input filters the session lists. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "bots">(() => {
    try {
      return (localStorage.getItem("hermes.sidebar.tab") as "sessions" | "bots") || "sessions";
    } catch {
      return "sessions";
    }
  });
  const [groupChats, setGroupChats] = useState<GroupChatRecord[]>(() =>
    loadStoredGroupChats(),
  );
  const [activityToasts, setActivityToasts] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hermes.activityToasts") !== "false";
    } catch {
      return true;
    }
  });

  const handleCreateGroupChat = useCallback(
    (name: string, memberIds: string[]) => {
      const record: GroupChatRecord = {
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        memberIds,
        createdAt: Date.now(),
        lastMessage: `Group with ${memberIds.length} bots`,
      };
      setGroupChats((prev) => {
        const next = [record, ...prev];
        saveStoredGroupChats(next);
        return next;
      });
      onOpenGroupChat?.(record);
    },
    [onOpenGroupChat],
  );
  const [showBotNewMenu, setShowBotNewMenu] = useState(false);
  const [showGroupChatModal, setShowGroupChatModal] = useState(false);
  const botNewMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("hermes.activityToasts", String(activityToasts));
    } catch {}
  }, [activityToasts]);

  useEffect(() => {
    if (!showBotNewMenu) return;
    const onClickOutside = (e: MouseEvent) => {
      if (botNewMenuRef.current && !botNewMenuRef.current.contains(e.target as Node)) {
        setShowBotNewMenu(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [showBotNewMenu]);
  const [profiles, setProfiles] = useState<
    Array<{
      id: string;
      name: string;
      model: string;
      provider: string;
      color?: string;
      avatar?: string | null;
      gatewayRunning: boolean;
      lastMessage?: string;
      lastActive?: number;
    }>
  >([]);
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  // True when the profile has more cache rows than the sidebar has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(() =>
    readStoredOpen(PROJECTS_OPEN_KEY),
  );
  const [chatsOpen, setChatsOpen] = useState(() =>
    readStoredOpen(CHATS_OPEN_KEY),
  );
  const [closedProjectFolders, setClosedProjectFolders] = useState<Set<string>>(
    () => readStoredClosedFolders(),
  );
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    readStoredPinned(),
  );
  const [pinnedOpen, setPinnedOpen] = useState(() =>
    readStoredOpen(PINNED_OPEN_KEY),
  );
  // Subagent/branch runs are hidden by default; the toggle reveals them
  // (with delete support) so nothing becomes unreachable.
  const [showSubagentRuns, setShowSubagentRuns] = useState(() =>
    readStoredBool(SHOW_SUBAGENT_RUNS_KEY, false),
  );
  // Row whose context menu is open, anchored to viewport coordinates.
  const [menuTarget, setMenuTarget] = useState<SidebarMenuTarget | null>(null);
  // Inline rename: the row id being edited and its working title.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingIdRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Project-heading context menu (right-click), anchored to the cursor.
  const [projectMenu, setProjectMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  // Inline project rename: the folder path being edited and its working alias.
  const [editingProjectPath, setEditingProjectPath] = useState<string | null>(
    null,
  );
  const [editingProjectAlias, setEditingProjectAlias] = useState("");
  const projectRenameInputRef = useRef<HTMLInputElement>(null);
  // Re-render whenever any project alias changes (see projectAliases.ts);
  // the version string also feeds the memo deps below so names recompute.
  const projectAliasesVersion = useProjectAliases();
  // Pending delete confirmation (small inline dialog in a portal-free overlay).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Multi-select bulk delete state.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState<
    { title: string; ids: string[] } | null
  >(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const lastRefreshRef = useRef(0);
  const sessionsRef = useRef<RecentSession[]>([]);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  useEffect(() => {
    storePinned(pinnedIds);
  }, [pinnedIds]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_SUBAGENT_RUNS_KEY, String(showSubagentRuns));
    } catch {
      /* ignore */
    }
    // Let the sidebar footer's subagent button reflect the state.
    window.dispatchEvent(
      new CustomEvent("hermes-sidebar-subagents-changed", {
        detail: showSubagentRuns,
      }),
    );
  }, [showSubagentRuns]);

  // The sidebar footer's subagent button toggles the same filter.
  useEffect(() => {
    const onToggle = (): void => setShowSubagentRuns((v) => !v);
    window.addEventListener("hermes-sidebar-toggle-subagents", onToggle);
    return () =>
      window.removeEventListener("hermes-sidebar-toggle-subagents", onToggle);
  }, []);

  const normalizeRows = useCallback<
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
        contextFolders?: string[];
        parentSessionId?: string | null;
      }>,
      limit?: number,
    ) => RecentSession[]
  >(
    (list, limit = RECENT_SESSIONS_PAGE_SIZE) =>
      // Subagent runs stay out of the default list; the toggle reveals them.
      list
        .filter((s) => showSubagentRuns || !s.parentSessionId)
        .slice(0, limit)
        .map(
          ({
            id,
            title,
            contextFolder,
            contextFolders,
            parentSessionId,
          }) => {
            const folder =
              (Array.isArray(contextFolders) && contextFolders[0]) ||
              contextFolder ||
              null;
            return {
              id,
              title,
              contextFolder: folder?.trim() || null,
              contextFolders: Array.isArray(contextFolders)
                ? contextFolders
                : folder
                  ? [folder]
                  : [],
              parentSessionId: parentSessionId ?? null,
            };
          },
        ),
    [showSubagentRuns],
  );

  const applyFirstPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const next = normalizeRows(list);
      // Skip the state update (and re-render) when nothing changed — the
      // common case for periodic refreshes.
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const applyLoadedWindow = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      const loadedLimit = Math.max(
        RECENT_SESSIONS_PAGE_SIZE,
        sessionsRef.current.length,
      );
      setHasMore(list.length > loadedLimit);
      const next = normalizeRows(list, loadedLimit);
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const appendPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const page = normalizeRows(list);
      if (page.length === 0) return;
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = [...prev];
        for (const session of page) {
          if (!seen.has(session.id)) next.push(session);
        }
        return sameSessions(prev, next) ? prev : next;
      });
    },
    [normalizeRows],
  );

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        applyLoadedWindow(synced);
      } catch {
        // keep whatever we had — the list is best-effort UI sugar
      }
    },
    [applyLoadedWindow],
  );

  const loadNextPage = useCallback(async (): Promise<void> => {
    if (!open || !hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await window.hermesAPI.listCachedSessions(
        RECENT_SESSIONS_PAGE_SIZE + 1,
        sessionsRef.current.length,
      );
      appendPage(nextPage);
    } catch {
      // keep the current list; scrolling can retry on the next event
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appendPage, open]);

  const maybeLoadNextPage = useCallback((): void => {
    const root = scrollRootRef.current;
    if (!projectsOpen && !chatsOpen) return;
    if (!root || !hasMoreRef.current || loadingMoreRef.current) return;
    const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
    if (remaining <= INFINITE_SCROLL_THRESHOLD_PX) void loadNextPage();
  }, [chatsOpen, loadNextPage, projectsOpen, scrollRootRef]);

  // Initial load when the section opens: paint from the JSON cache
  // immediately (no DB access), then sync once for anything new.
  // Sequenced so sync always wins over cache (avoids race where stale
  // cache overwrites fresh sync if sync resolves first).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await window.hermesAPI.listCachedSessions(
          // One over the page size so the cache read alone can decide whether
          // another page exists without a separate count query.
          RECENT_SESSIONS_PAGE_SIZE + 1,
        );
        if (!cancelled) applyFirstPage(cached);
      } catch {
        /* ignore cache read errors */
      }
      lastRefreshRef.current = Date.now();
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        if (!cancelled) applyFirstPage(synced);
      } catch {
        // cache read above already painted something
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeProfile, applyFirstPage]);

  useEffect(() => {
    try {
      localStorage.setItem("hermes.sidebar.tab", sidebarTab);
    } catch {}
  }, [sidebarTab]);

  const loadBotProfiles = useCallback(async () => {
    try {
      const list = await window.hermesAPI.listProfiles();
      // Fetch latest session for each bot individually using cached/session queries
      const enriched = await Promise.all(
        list.map(async (p) => {
          let lastMessage = "";
          let lastActive = 0;
          try {
            // Read cached sessions for this specific profile directly from cache
            const profileSessions = await window.hermesAPI.listCachedSessions(1);
            if (profileSessions && profileSessions.length > 0 && p.id === activeProfile) {
              lastMessage = profileSessions[0].title || "";
            }
          } catch {}
          return {
            ...p,
            lastMessage: lastMessage || (p.model ? p.model.split("/").pop() : undefined),
            lastActive,
          };
        }),
      );
      setProfiles(enriched);
    } catch {}
  }, [activeProfile]);

  useEffect(() => {
    if (open && sidebarTab === "bots") {
      void loadBotProfiles();
    }
  }, [open, sidebarTab, loadBotProfiles]);

  const handleOpenBotChat = useCallback(
    async (profileId: string) => {
      onChatWithBot?.(profileId);
      // Ensure the profile is selected and activated in UI & backend
      try {
        await window.hermesAPI.setActiveProfile(profileId);
      } catch {}
      void loadBotProfiles();
    },
    [onChatWithBot, loadBotProfiles],
  );

  // While open: pick up background sessions (gateway, cron, other devices)
  // on focus and on a slow timer. No listeners or timers at all when closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), RECENT_REFRESH_MS);
    const onFocus = (): void => {
      void refresh();
    };
    const onContextFolderChanged = (): void => {
      void refresh(true);
    };
    const onSessionDbSynced = (): void => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "hermes-session-context-folder-changed",
      onContextFolderChanged,
    );
    window.addEventListener("hermes-session-db-synced", onSessionDbSynced);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "hermes-session-context-folder-changed",
        onContextFolderChanged,
      );
      window.removeEventListener("hermes-session-db-synced", onSessionDbSynced);
    };
  }, [open, refresh]);

  const pendingMaybeLoadRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const onScroll = (): void => {
      if (pendingMaybeLoadRef.current) return;
      pendingMaybeLoadRef.current = true;
      queueMicrotask(() => {
        pendingMaybeLoadRef.current = false;
        maybeLoadNextPage();
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNextPage();
    return () => {
      root.removeEventListener("scroll", onScroll);
      pendingMaybeLoadRef.current = false;
    };
  }, [maybeLoadNextPage, open, scrollRootRef]);

  // If the first page does not fill the sidebar, keep paging until the scroll
  // container has real overflow or the cache runs out.
  useEffect(() => {
    if (open) maybeLoadNextPage();
  }, [hasMore, maybeLoadNextPage, open, sessions.length]);

  // Resuming/switching sessions reorders recency — refresh (throttled).
  // Also refreshes when going to "New Chat" (currentSessionId becomes null)
  // so the just-left session appears in the list immediately.
  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId, refresh]);

  // Switching agent points the list at a different profile's DB. Force a
  // reload immediately (bypassing the throttle) so the list isn't stale.
  const prevProfileRef = useRef(activeProfile);
  useEffect(() => {
    if (prevProfileRef.current === activeProfile) return;
    prevProfileRef.current = activeProfile;
    void refresh(true);
  }, [activeProfile, refresh]);

  // Keep the wrapper mounted so the collapse/expand animates with CSS grid
  // tracks. Effects above are still gated on `open`, so a collapsed sidebar
  // does no fetching while keeping the last-loaded list ready to animate.
  const expanded = open;

  // Pinned rows are pulled out of the normal grouping and shown in their own
  // section at the top (ChatGPT-style), preserving recency order.
  const pinnedSessions = useMemo(
    () => sessions.filter((s) => pinnedIds.has(s.id)),
    [sessions, pinnedIds],
  );
  const { projectGroups, chats } = useMemo(
    () =>
      groupSessionsByWorkspace(sessions.filter((s) => !pinnedIds.has(s.id))),
    [sessions, pinnedIds, projectAliasesVersion],
  );

  // Session search (the magnifier next to the collapse toggle): filters every
  // section by title or context folder, case-insensitively.
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const q = searchQuery.trim().toLowerCase();
  const matchesQuery = (s: RecentSession): boolean =>
    !q ||
    s.title.toLowerCase().includes(q) ||
    (s.contextFolder ?? "").toLowerCase().includes(q);
  const filteredPinned = useMemo(
    () => (q ? pinnedSessions.filter(matchesQuery) : pinnedSessions),
    [pinnedSessions, q],
  );
  // While searching, matching sections force-open: the query already
  // whittled the lists to matches, so collapsing them would hide results.
  const effectiveProjectsOpen = q !== "" ? true : projectsOpen;
  const effectiveChatsOpen = q !== "" ? true : chatsOpen;

  const filteredChats = useMemo(
    () => (q ? chats.filter(matchesQuery) : chats),
    [chats, q],
  );
  const filteredGroups = useMemo(
    () =>
      q
        ? projectGroups
            .map((g) => ({ ...g, sessions: g.sessions.filter(matchesQuery) }))
            .filter((g) => g.sessions.length > 0)
        : projectGroups,
    [projectGroups, q],
  );
  const noMatches = q && filteredChats.length === 0 && filteredPinned.length === 0 && filteredGroups.length === 0;
  // Auto-focus on open; clear the query when closed.
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      setSearchQuery("");
    }
  }, [searchOpen]);

  // Every distinct project folder currently in use, so "Move to project" lists
  // them all — even ones whose only conversation is pinned or filtered out.
  const projectChoices = useMemo<SidebarMenuProject[]>(() => {
    const byPath = new Map<string, SidebarMenuProject>();
    for (const s of sessions) {
      const folder = s.contextFolder?.trim();
      if (folder && !byPath.has(folder)) {
        byPath.set(folder, { path: folder, name: projectDisplayName(folder) });
      }
    }
    return Array.from(byPath.values());
  }, [sessions, projectAliasesVersion]);

  const togglePinned = (): void => {
    setPinnedOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PINNED_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const handleTogglePin = useCallback((id: string): void => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startRename = useCallback((s: RecentSession): void => {
    setEditingId(s.id);
    setEditingTitle(s.title || "");
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelRename = useCallback((): void => {
    setEditingId(null);
    setEditingTitle("");
  }, []);

  const confirmRename = useCallback(
    async (id: string, value: string): Promise<void> => {
      const trimmed = value.trim();
      const current = sessionsRef.current.find((s) => s.id === id);
      if (!trimmed || trimmed === (current?.title ?? "")) {
        cancelRename();
        return;
      }
      const previous = current?.title ?? "";
      // Optimistic local update; roll back if the write fails.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
      );
      if (editingIdRef.current === id) cancelRename();
      try {
        await window.hermesAPI.updateSessionTitle(id, trimmed);
        // Keep the top-bar session tab in sync with a sidebar rename: the
        // ActiveSessionsBar label comes from Layout's runs state, which has no
        // other way to learn about a rename performed here.
        window.dispatchEvent(
          new CustomEvent("hermes-session-title-changed", {
            detail: { sessionId: id, title: trimmed },
          }),
        );
      } catch (err) {
        console.error("Failed to rename session", id, err);
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title: previous } : s)),
        );
      }
    },
    [cancelRename],
  );

  const startProjectRename = useCallback((path: string): void => {
    setEditingProjectPath(path);
    setEditingProjectAlias(getProjectAlias(path) ?? projectDisplayName(path));
    setTimeout(() => {
      projectRenameInputRef.current?.focus();
      projectRenameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelProjectRename = useCallback((): void => {
    setEditingProjectPath(null);
    setEditingProjectAlias("");
  }, []);

  const confirmProjectRename = useCallback(
    (path: string, value: string): void => {
      const trimmed = value.trim();
      const current = getProjectAlias(path) ?? projectDisplayName(path);
      if (trimmed !== current) setProjectAlias(path, trimmed);
      cancelProjectRename();
    },
    [cancelProjectRename],
  );

  // Dismiss the project context menu on outside mousedown while it is open.
  useEffect(() => {
    if (!projectMenu) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".sidebar-project-rename-menu")) {
        setProjectMenu(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [projectMenu]);

  const handleMoveToProject = useCallback(
    async (id: string, folder: string | null): Promise<void> => {
      const normalized = folder?.trim() || null;
      const current = sessionsRef.current.find((s) => s.id === id);
      if ((current?.contextFolder ?? null) === normalized) return;
      const previous = current?.contextFolder ?? null;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, contextFolder: normalized } : s,
        ),
      );
      try {
        await window.hermesAPI.setSessionContextFolder(id, normalized);
        // Other surfaces (chat view, Sessions screen) listen for this to
        // refresh their own grouping.
        window.dispatchEvent(
          new CustomEvent("hermes-session-context-folder-changed"),
        );
      } catch (err) {
        console.error("Failed to move session to project", id, err);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, contextFolder: previous } : s,
          ),
        );
      }
    },
    [],
  );

  const handlePickNewFolder = useCallback(
    async (id: string): Promise<void> => {
      try {
        const folder = await window.hermesAPI.selectFolder();
        if (folder) await handleMoveToProject(id, folder);
      } catch (err) {
        console.error("Folder selection failed", err);
      }
    },
    [handleMoveToProject],
  );

  const confirmDelete = useCallback(
    async (id: string): Promise<void> => {
      setDeleting(true);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setPinnedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        await window.hermesAPI.deleteSession(id);
        onSessionDeleted?.(id);
      } catch (err) {
        console.error("Failed to delete session", id, err);
      } finally {
        setDeleting(false);
        setPendingDeleteId(null);
        void refresh(true);
      }
    },
    [onSessionDeleted, refresh],
  );

  const confirmBulkDelete = useCallback(
    async (ids: string[]): Promise<void> => {
      setBulkDeleting(true);
      const idSet = new Set(ids);
      setSessions((prev) => prev.filter((s) => !idSet.has(s.id)));
      setPinnedIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of ids) {
          if (next.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      try {
        if (ids.length === 1) {
          await window.hermesAPI.deleteSession(ids[0]);
          onSessionDeleted?.(ids[0]);
        } else {
          await window.hermesAPI.deleteSessions(ids);
          for (const id of ids) onSessionDeleted?.(id);
        }
      } catch (err) {
        console.error("Failed to bulk delete sessions", ids, err);
      } finally {
        setBulkDeleting(false);
        setPendingBulkDelete(null);
        setSelectedIds(new Set());
        setSelectMode(false);
        void refresh(true);
      }
    },
    [onSessionDeleted, refresh],
  );

  const handleToggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelectionForProject = useCallback((groupIds: string[]): void => {
    setSelectedIds(new Set());
    setSelectMode(true);
    const next = new Set<string>();
    for (const id of groupIds) next.add(id);
    setSelectedIds(next);
  }, []);

  const requestDeleteAllInProject = useCallback(
    (projectName: string, groupIds: string[]): void => {
      setPendingBulkDelete({
        title: `Delete all ${groupIds.length} conversation${groupIds.length === 1 ? "" : "s"} in "${projectName}"?`,
        ids: groupIds,
      });
    },
    [],
  );

  const requestDeleteSelected = useCallback((): void => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setPendingBulkDelete({
      title: `Delete ${ids.length} selected conversation${ids.length === 1 ? "" : "s"}?`,
      ids,
    });
  }, [selectedIds]);

  const openMenuForSession = useCallback(
    (s: RecentSession, x: number, y: number): void => {
      setMenuTarget({
        id: s.id,
        title: s.title,
        contextFolder: s.contextFolder ?? null,
        x,
        y,
      });
    },
    [],
  );

  const toggleProjects = (): void => {
    setProjectsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJECTS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleChats = (): void => {
    setChatsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHATS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleProjectFolder = (path: string): void => {
    setClosedProjectFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      storeClosedFolders(next);
      return next;
    });
  };

  const renderSessionButton = (
    s: RecentSession,
    project = false,
    visible = expanded,
    pinned = false,
  ): React.JSX.Element => {
    const title = s.title || t("sessions.newConversation");
    const loading = resumingSessionId === s.id || loadingSessionIds.has(s.id);
    const active = !loading && currentSessionId === s.id;
    const editing = editingId === s.id;
    const menuOpen = menuTarget?.id === s.id;

    if (editing) {
      return (
        <div
          key={s.id}
          className={`sidebar-recent-session ${
            project ? "project-child" : ""
          } editing`}
        >
          <input
            ref={renameInputRef}
            className="sidebar-recent-session-rename"
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmRename(s.id, editingTitle);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => void confirmRename(s.id, editingTitle)}
            tabIndex={visible ? 0 : -1}
          />
        </div>
      );
    }

    // `div role=button` (not <button>) so the trailing "options" control can be
    // a real nested button without invalid button-in-button markup.
    return (
      <div
        key={s.id}
        role="button"
        tabIndex={visible ? 0 : -1}
        className={`sidebar-recent-session ${project ? "project-child" : ""} ${
          active ? "active" : ""
        } ${menuOpen ? "menu-open" : ""} ${
          q !== "" && matchesQuery(s) ? "search-match" : ""
        }`}
        onClick={() => (selectMode ? handleToggleSelect(s.id) : onSelect(s.id))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selectMode) handleToggleSelect(s.id);
            else onSelect(s.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuForSession(s, e.clientX, e.clientY);
        }}
        title={title}
      >
        {selectMode && (
          <input
            type="checkbox"
            className="sidebar-recent-session-select"
            checked={selectedIds.has(s.id)}
            onChange={() => handleToggleSelect(s.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${title}`}
          />
        )}
        {loading ? (
          <>
            <Loader
              className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
              size={11}
            />
            {/* Official-style rotating light ring around the processing row. */}
            <span aria-hidden="true" className="arc-border arc-row" />
          </>
        ) : pinned ? (
          <Pin className="sidebar-recent-session-dot" size={11} />
        ) : (
          <Circle
            className={`sidebar-recent-session-dot ${
              active ? "sidebar-recent-session-dot--active" : ""
            }`}
            size={7}
            fill={active ? "currentColor" : "none"}
          />
        )}
        <span className="sidebar-recent-session-title">
          {s.parentSessionId && (
            <Bot
              className="sidebar-recent-session-sub"
              size={10}
              aria-label="Subagent run"
            />
          )}
          {title}
        </span>
        <button
          type="button"
          className="sidebar-recent-session-options"
          tabIndex={visible ? 0 : -1}
          aria-label={t("navigation.sessionMenu.options")}
          title={t("navigation.sessionMenu.options")}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openMenuForSession(s, rect.right, rect.bottom + 4);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    );
  };

  return (
    <div
      className={`sidebar-recent-sessions-wrap ${expanded ? "expanded" : ""}`}
      aria-hidden={!expanded}
    >
      {/* ── Official-style Sessions | Bots segment switcher ── */}
      <div className="sidebar-mode-segmented-control">
        <button
          type="button"
          className={`sidebar-mode-tab ${
            sidebarTab === "sessions" ? "active" : ""
          }`}
          onClick={() => setSidebarTab("sessions")}
        >
          <span>Sessions</span>
        </button>
        <button
          type="button"
          className={`sidebar-mode-tab ${sidebarTab === "bots" ? "active" : ""}`}
          onClick={() => setSidebarTab("bots")}
        >
          <Bot size={13} />
          <span>Bots</span>
        </button>
      </div>

      {sidebarTab === "bots" ? (
        <div className="sidebar-bots-rail">
          <div className="sidebar-bots-rail-header">
            <span className="sidebar-bots-rail-title">Bots</span>
            <div className="sidebar-bots-header-actions" ref={botNewMenuRef}>
              <button
                type="button"
                className={`sidebar-bots-icon-btn ${activityToasts ? "active" : ""}`}
                onClick={() => setActivityToasts((prev) => !prev)}
                title={
                  activityToasts
                    ? "Activity toasts on — click to silence"
                    : "Activity toasts off — click to enable"
                }
                aria-label="Toggle activity toasts"
              >
                {activityToasts ? <Bell size={13} /> : <BellOff size={13} />}
              </button>

              <button
                type="button"
                className="sidebar-bots-icon-btn"
                onClick={() => setShowBotNewMenu((prev) => !prev)}
                title="New Bot or Group Chat"
                aria-label="New Bot or Group Chat"
              >
                <Plus size={14} />
              </button>

              {showBotNewMenu && (
                <div className="sidebar-bots-dropdown-menu">
                  <button
                    type="button"
                    className="sidebar-bots-dropdown-item"
                    onClick={() => {
                      setShowBotNewMenu(false);
                      window.dispatchEvent(
                        new CustomEvent("navigation:goto", { detail: "agents" }),
                      );
                    }}
                  >
                    <Bot size={13} />
                    <span>New Bot</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-bots-dropdown-item"
                    onClick={() => {
                      setShowBotNewMenu(false);
                      setShowGroupChatModal(true);
                    }}
                  >
                    <Users size={13} />
                    <span>New Group Chat</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-bots-rail-list">
            {/* ── Group Chats Section ── */}
            {groupChats.length > 0 && (
              <div className="sidebar-group-chats-wrap">
                <div className="sidebar-group-chats-heading">
                  <Users size={12} />
                  <span>Group Chats ({groupChats.length})</span>
                </div>
                {groupChats.map((g) => {
                  const isGroupActive = currentGroupChatId === g.id;
                  return (
                    <div
                      key={g.id}
                      role="button"
                      tabIndex={0}
                      className={`sidebar-bot-row group-row ${isGroupActive ? "active" : ""}`}
                      onClick={() => {
                        onOpenGroupChat?.(g);
                      }}
                    >
                      <div className="sidebar-bot-avatar-wrap">
                        <div className="sidebar-group-avatar">
                          <Users size={14} />
                        </div>
                      </div>
                      <div className="sidebar-bot-info">
                        <div className="sidebar-bot-name-row">
                          <span className="sidebar-bot-name">{g.name}</span>
                          <span className="sidebar-group-count">
                            {g.memberIds.length} bots
                          </span>
                        </div>
                        <div className="sidebar-bot-model-sub">
                          <span className="sidebar-bot-last-msg">
                            {g.memberIds.map((m) => `@${m}`).join(" ")}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Direct Bots List ── */}
            <div className="sidebar-group-chats-heading">
              <Bot size={12} />
              <span>Direct Messages</span>
            </div>
            {profiles.map((p) => {
              const isCurrentActive = !currentGroupChatId && activeProfile === p.id;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className={`sidebar-bot-row ${isCurrentActive ? "active" : ""}`}
                  onClick={() => handleOpenBotChat(p.id)}
                >
                  <div className="sidebar-bot-avatar-wrap">
                    <ProfileAvatar
                      name={p.id}
                      color={p.color}
                      avatar={p.avatar}
                      size={24}
                    />
                    <span
                      className={`sidebar-bot-dot ${
                        p.gatewayRunning ? "on" : "off"
                      }`}
                    />
                  </div>
                  <div className="sidebar-bot-info">
                    <div className="sidebar-bot-name-row">
                      <span className="sidebar-bot-name">{p.name}</span>
                      {isCurrentActive && (
                        <span className="sidebar-bot-active-pill">Active</span>
                      )}
                    </div>
                    <div className="sidebar-bot-model-sub">
                      {p.lastMessage ? (
                        <span className="sidebar-bot-last-msg">{p.lastMessage}</span>
                      ) : (
                        <span>{p.model ? p.model.split("/").pop() : "No model"}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="sidebar-recent-sessions">
        {selectMode && (
          <div className="sidebar-recent-selection-toolbar">
            <span>{selectedIds.size} selected</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={requestDeleteSelected}
              disabled={selectedIds.size === 0}
            >
              Delete ({selectedIds.size})
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setSelectMode(false);
                setSelectedIds(new Set());
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {searchOpen && (
          <div className="sidebar-recent-search">
            <Search size={13} className="sidebar-recent-search-icon" />
            <input
              ref={searchInputRef}
              className="sidebar-recent-search-input"
              type="text"
              placeholder={t("navigation.searchSessions")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQuery("");
                  onSearchOpenChange(false);
                }
              }}
              aria-label={t("navigation.searchSessions")}
            />
            {searchQuery ? (
              <button
                type="button"
                className="sidebar-recent-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                tabIndex={expanded ? 0 : -1}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        )}
        {noMatches && (
          <div className="sidebar-recent-empty sidebar-recent-no-matches">
            {t("navigation.noSearchMatches")}
          </div>
        )}
        {filteredPinned.length > 0 && (
          <div className="sidebar-recent-section">
            <button
              type="button"
              className="sidebar-recent-section-toggle"
              onClick={togglePinned}
              aria-expanded={pinnedOpen}
              tabIndex={expanded ? 0 : -1}
              onContextMenu={(e) => {
                if (pinnedSessions.length === 0) return;
                e.preventDefault();
                setProjectMenu({
                  path: "__pinned__",
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <span>{t("navigation.pinned")}</span>
              {pinnedOpen ? (
                <ChevronDown
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              ) : (
                <ChevronRight
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              )}
            </button>
            <div
              className={`sidebar-recent-collapse ${
                pinnedOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {filteredPinned.map((s) =>
                  renderSessionButton(s, false, expanded && pinnedOpen, true),
                )}
              </div>
            </div>
          </div>
        )}
        {filteredGroups.length > 0 && (
          <div className="sidebar-recent-section">
            <button
              type="button"
              className="sidebar-recent-section-toggle"
              onClick={toggleProjects}
              aria-expanded={effectiveProjectsOpen}
              tabIndex={expanded ? 0 : -1}
            >
              <span>{t("navigation.projects")}</span>
              {effectiveProjectsOpen ? (
                <ChevronDown
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              ) : (
                <ChevronRight
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              )}
            </button>
            <div
              className={`sidebar-recent-collapse ${
                effectiveProjectsOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {filteredGroups.map((group) => {
                  const projectOpen =
                    q !== ""
                      ? true
                      : !closedProjectFolders.has(group.path);
                  const visible =
                    expanded && effectiveProjectsOpen && projectOpen;
                  return (
                    <div className="sidebar-recent-project" key={group.path}>
                      {editingProjectPath === group.path ? (
                        <input
                          ref={projectRenameInputRef}
                          className="sidebar-recent-project-rename"
                          type="text"
                          value={editingProjectAlias}
                          onChange={(e) =>
                            setEditingProjectAlias(e.target.value)
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              confirmProjectRename(
                                group.path,
                                editingProjectAlias,
                              );
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelProjectRename();
                            }
                          }}
                          onBlur={() =>
                            confirmProjectRename(
                              group.path,
                              editingProjectAlias,
                            )
                          }
                          tabIndex={expanded && projectsOpen ? 0 : -1}
                        />
                      ) : (
                        <button
                          type="button"
                          className="sidebar-recent-project-heading"
                          title={group.path}
                          onClick={() => toggleProjectFolder(group.path)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setProjectMenu({
                              path: group.path,
                              x: e.clientX,
                              y: e.clientY,
                            });
                          }}
                          aria-expanded={projectOpen}
                          tabIndex={expanded && projectsOpen ? 0 : -1}
                        >
                          <Folder size={13} />
                          <span>{group.name}</span>
                          {projectOpen ? (
                            <ChevronDown
                              className="sidebar-recent-disclosure-icon"
                              size={12}
                            />
                          ) : (
                            <ChevronRight
                              className="sidebar-recent-disclosure-icon"
                              size={12}
                            />
                          )}
                        </button>
                      )}
                      <div
                        className={`sidebar-recent-collapse ${
                          projectOpen ? "expanded" : ""
                        }`}
                      >
                        <div className="sidebar-recent-collapse-inner">
                          {group.sessions.map((s) =>
                            renderSessionButton(s, true, visible),
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="sidebar-recent-section">
          <button
            type="button"
            className="sidebar-recent-section-toggle"
            onClick={toggleChats}
            aria-expanded={effectiveChatsOpen}
            tabIndex={expanded ? 0 : -1}
            onContextMenu={(e) => {
              if (chats.length === 0) return;
              e.preventDefault();
              setProjectMenu({
                path: "__chats__",
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            <span>{t("navigation.chats")}</span>
            {effectiveChatsOpen ? (
              <ChevronDown
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            ) : (
              <ChevronRight
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            )}
          </button>
          <div
            className={`sidebar-recent-collapse ${
              effectiveChatsOpen ? "expanded" : ""
            }`}
          >
            <div className="sidebar-recent-collapse-inner">
              {filteredChats.length > 0 ? (
                filteredChats.map((s) =>
                  renderSessionButton(s, false, expanded && effectiveChatsOpen),
                )
              ) : q ? null : (
                <div className="sidebar-recent-empty">
                  {t("navigation.noChats")}
                </div>
              )}
            </div>
          </div>
        </div>
        {loadingMore && (
          <div className="sidebar-recent-loading" aria-live="polite">
            <Loader
              className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
              size={11}
            />
            <span>{t("common.loadingShort")}</span>
          </div>
        )}
        </div>
      )}

      {expanded &&
        projectMenu &&
        createPortal(
          <div
            className="sidebar-project-rename-menu"
            style={{ left: projectMenu.x, top: projectMenu.y }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {projectMenu.path !== "__chats__" && projectMenu.path !== "__pinned__" && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const targetPath = projectMenu.path;
                    setProjectMenu(null);
                    onNewChatInProject?.(targetPath);
                  }}
                >
                  + New Chat in Project
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    startProjectRename(projectMenu.path);
                    setProjectMenu(null);
                  }}
                >
                  {t("navigation.renameProject")}
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const targetPath = projectMenu.path;
                setProjectMenu(null);
                const targetSessions =
                  targetPath === "__chats__"
                    ? chats
                    : targetPath === "__pinned__"
                      ? pinnedSessions
                      : (projectGroups.find((g) => g.path === targetPath)?.sessions ?? []);
                enterSelectionForProject(targetSessions.map((s) => s.id));
              }}
            >
              Select all in section
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              style={{ color: "var(--color-danger)" }}
              onClick={() => {
                const targetPath = projectMenu.path;
                setProjectMenu(null);
                const targetSessions =
                  targetPath === "__chats__"
                    ? chats
                    : targetPath === "__pinned__"
                      ? pinnedSessions
                      : (projectGroups.find((g) => g.path === targetPath)?.sessions ?? []);
                const name =
                  targetPath === "__chats__"
                    ? "Chats"
                    : targetPath === "__pinned__"
                      ? "Pinned"
                      : (projectGroups.find((g) => g.path === targetPath)?.name ?? "Project");
                requestDeleteAllInProject(name, targetSessions.map((s) => s.id));
              }}
            >
              Delete all ({
                targetPathCount(projectMenu.path, chats, pinnedSessions, projectGroups)
              })
            </button>
          </div>,
          document.body,
        )}
      {expanded && menuTarget && (
        <SidebarSessionMenu
          target={menuTarget}
          isPinned={pinnedIds.has(menuTarget.id)}
          projects={projectChoices}
          scrollContainer={scrollRootRef.current}
          onClose={() => setMenuTarget(null)}
          onTogglePin={() => handleTogglePin(menuTarget.id)}
          onRename={() => {
            const s = sessions.find((row) => row.id === menuTarget.id);
            if (s) startRename(s);
          }}
          onMoveToProject={(path) =>
            void handleMoveToProject(menuTarget.id, path)
          }
          onPickNewFolder={() => void handlePickNewFolder(menuTarget.id)}
          onDelete={() => setPendingDeleteId(menuTarget.id)}
        />
      )}
      {pendingDeleteId &&
        createPortal(
          <div
            className="sidebar-session-delete-overlay"
            role="presentation"
            onClick={() => {
              if (!deleting) setPendingDeleteId(null);
            }}
          >
            <div
              className="sidebar-session-delete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sidebar-session-delete-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sidebar-session-delete-header">
                <h3 id="sidebar-session-delete-title">
                  {t("navigation.sessionMenu.deleteConfirmTitle")}
                </h3>
                <button
                  type="button"
                  className="btn-ghost sidebar-session-delete-close"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                  aria-label={t("navigation.sessionMenu.deleteCancel")}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="sidebar-session-delete-body">
                {t("navigation.sessionMenu.deleteConfirm")}
              </p>
              <div className="sidebar-session-delete-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                >
                  {t("navigation.sessionMenu.deleteCancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete(pendingDeleteId)}
                  disabled={deleting}
                >
                  {deleting
                    ? t("navigation.sessionMenu.deleting")
                    : t("navigation.sessionMenu.deleteConfirmAction")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {pendingBulkDelete &&
        createPortal(
          <div
            className="sidebar-session-delete-overlay"
            role="presentation"
            onClick={() => {
              if (!bulkDeleting) setPendingBulkDelete(null);
            }}
          >
            <div
              className="sidebar-session-delete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sidebar-bulk-delete-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sidebar-session-delete-header">
                <h3 id="sidebar-bulk-delete-title">
                  {pendingBulkDelete.title}
                </h3>
                <button
                  type="button"
                  className="btn-ghost sidebar-session-delete-close"
                  onClick={() => setPendingBulkDelete(null)}
                  disabled={bulkDeleting}
                  aria-label={t("navigation.sessionMenu.deleteCancel")}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="sidebar-session-delete-body">
                {t("navigation.sessionMenu.deleteConfirm")}
              </p>
              <div className="sidebar-session-delete-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingBulkDelete(null)}
                  disabled={bulkDeleting}
                >
                  {t("navigation.sessionMenu.deleteCancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmBulkDelete(pendingBulkDelete.ids)}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting
                    ? t("navigation.sessionMenu.deleting")
                    : t("navigation.sessionMenu.deleteConfirmAction")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <CreateGroupChatModal
        open={showGroupChatModal}
        onClose={() => setShowGroupChatModal(false)}
        onCreated={(groupName, memberIds) => {
          handleCreateGroupChat(groupName, memberIds);
        }}
      />
    </div>
  );
});

export default SidebarRecentSessions;