import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Refresh, X } from "../../assets/icons";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import type {
  DashboardSkill,
  DashboardToolset,
  HubPreview,
  HubScan,
  HubSkill,
  HubSourcesResult,
} from "../../../../shared/capabilities";

export type CapabilityTab = "skills" | "toolsets" | "mcp" | "hub";

interface CapabilitiesProps {
  profile?: string;
  visible?: boolean;
  focusTab?: { tab: CapabilityTab; nonce: number };
}

const TRUST_TONES: Record<string, string> = {
  builtin: "cap-badge cap-badge--builtin",
  trusted: "cap-badge cap-badge--trusted",
  community: "cap-badge cap-badge--community",
};

export function trustTone(trustLevel: string): string {
  return TRUST_TONES[trustLevel] ?? "cap-badge cap-badge--community";
}

// ── MCP helpers (ported from the old Tools screen) ────────────────────────

interface McpServer {
  name: string;
  type: "http" | "stdio" | "unknown";
  transport: "http" | "stdio" | "unknown";
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

interface AddMcpForm {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  argsText: string;
  envText: string;
  auth: string;
}

const EMPTY_ADD_FORM: AddMcpForm = {
  name: "",
  type: "http",
  url: "",
  command: "",
  argsText: "",
  envText: "",
  auth: "",
};

function parseArgsText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return env;
}

interface McpServerInput {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

/** Map the visual form to the add/update payload. */
function formToInput(form: AddMcpForm): McpServerInput {
  return {
    name: form.name,
    type: form.type,
    url: form.type === "http" ? form.url : undefined,
    command: form.type === "stdio" ? form.command : undefined,
    args: form.type === "stdio" ? parseArgsText(form.argsText) : [],
    env: form.type === "stdio" ? parseEnvText(form.envText) : {},
    auth: form.auth || undefined,
  };
}

/** Serialise the form (+ enabled) to the raw "Server JSON" for full edit. */
function formToJson(form: AddMcpForm, enabled: boolean): string {
  const obj: Record<string, unknown> = {};
  if (form.type === "http") {
    obj.url = form.url;
    if (form.auth) obj.auth = form.auth;
  } else {
    obj.command = form.command;
    const args = parseArgsText(form.argsText);
    if (args.length) obj.args = args;
    const env = parseEnvText(form.envText);
    if (Object.keys(env).length) obj.env = env;
  }
  obj.enabled = enabled;
  return JSON.stringify(obj, null, 2);
}

/** Parse the raw "Server JSON" back into form fields (+ optional enabled). */
function parseServerJson(
  text: string,
): { form: Omit<AddMcpForm, "name">; enabled?: boolean } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Expected a JSON object." };
  }
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  const command = typeof o.command === "string" ? o.command : "";
  const args = Array.isArray(o.args) ? o.args.map((a) => String(a)) : [];
  const envText =
    o.env && typeof o.env === "object" && !Array.isArray(o.env)
      ? Object.entries(o.env as Record<string, unknown>)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join("\n")
      : "";
  return {
    form: {
      type: url.trim() ? "http" : "stdio",
      url,
      command,
      argsText: args.join("\n"),
      envText,
      auth: typeof o.auth === "string" ? o.auth : "",
    },
    enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
  };
}

function TinyIcon({
  kind,
}: {
  kind:
    | "plus"
    | "refresh"
    | "trash"
    | "test"
    | "server"
    | "x"
    | "install"
    | "edit";
}): React.JSX.Element {
  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (kind === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (kind === "refresh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
      </svg>
    );
  }
  if (kind === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 18h10l1-18M10 11v6M14 11v6" />
      </svg>
    );
  }
  if (kind === "test") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M10 2v6L4 19a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L14 8V2M8 14h8" />
      </svg>
    );
  }
  if (kind === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  if (kind === "install") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="18" r="1" />
    </svg>
  );
}

export default function Capabilities({
  profile,
  visible = true,
  focusTab,
}: CapabilitiesProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<CapabilityTab>("skills");
  const [skills, setSkills] = useState<DashboardSkill[]>([]);
  const [toolsets, setToolsets] = useState<DashboardToolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [toolsetBusy, setToolsetBusy] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<DashboardSkill | null>(null);
  const [detailToolset, setDetailToolset] = useState<DashboardToolset | null>(
    null,
  );
  const [skillContent, setSkillContent] = useState("");
  // MCP tab state
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpError, setMcpError] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpBusy, setMcpBusy] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [addForm, setAddForm] = useState<AddMcpForm>(EMPTY_ADD_FORM);
  const [editingMcpName, setEditingMcpName] = useState<string | null>(null);
  const [mcpEditMode, setMcpEditMode] = useState<"visual" | "json">("visual");
  const [mcpJsonText, setMcpJsonText] = useState("");
  const [mcpJsonError, setMcpJsonError] = useState("");
  const [editingEnabled, setEditingEnabled] = useState(true);
  const [mcpSearch, setMcpSearch] = useState("");
  // Hub tab state
  const [hubSources, setHubSources] = useState<HubSourcesResult | null>(null);
  const [hubResults, setHubResults] = useState<HubSkill[]>([]);
  const [hubInstalled, setHubInstalled] = useState<
    Record<string, { name: string }>
  >({});
  const [hubSearching, setHubSearching] = useState(false);
  const [hubPreview, setHubPreview] = useState<HubPreview | null>(null);
  const [hubScan, setHubScan] = useState<HubScan | null>(null);
  const [hubScanning, setHubScanning] = useState(false);
  const [hubBusy, setHubBusy] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab.tab);
  }, [focusTab]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      // Fetch each source independently: a slow or failing endpoint (e.g.
      // the dashboard busy mid-turn) must not blank the whole screen — the
      // tabs that did load still render, and only the failed source reports.
      const [s, ts, mcp, hub] = await Promise.all([
        window.hermesAPI
          .getDashboardSkills(profile)
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            return [] as Awaited<ReturnType<typeof window.hermesAPI.getDashboardSkills>>;
          }),
        window.hermesAPI
          .getDashboardToolsets(profile)
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            return [] as Awaited<ReturnType<typeof window.hermesAPI.getDashboardToolsets>>;
          }),
        window.hermesAPI
          .listMcpServers(profile)
          .catch(() => [] as Awaited<ReturnType<typeof window.hermesAPI.listMcpServers>>),
        window.hermesAPI.getHubSources(profile).catch(() => null),
      ]);
      setSkills(s);
      setToolsets(ts);
      setMcpServers(mcp);
      setHubSources(hub);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const filteredToolsets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return toolsets;
    return toolsets.filter(
      (ts) =>
        ts.name.toLowerCase().includes(q) ||
        ts.label.toLowerCase().includes(q) ||
        ts.description.toLowerCase().includes(q) ||
        ts.tools.some((tool) => tool.toLowerCase().includes(q)),
    );
  }, [toolsets, query]);

  const handleToggleSkill = useCallback(
    async (skill: DashboardSkill): Promise<void> => {
      const next = !skill.enabled;
      setSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? { ...s, enabled: next } : s)),
      );
      setSkillBusy(skill.name);
      try {
        await window.hermesAPI.setDashboardSkillEnabled(
          skill.name,
          next,
          profile,
        );
      } catch (err) {
        setSkills((prev) =>
          prev.map((s) =>
            s.name === skill.name ? { ...s, enabled: !next } : s,
          ),
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSkillBusy(null);
      }
    },
    [profile],
  );

  const handleToggleToolset = useCallback(
    async (toolset: DashboardToolset): Promise<void> => {
      const next = !toolset.enabled;
      setToolsets((prev) =>
        prev.map((ts) =>
          ts.name === toolset.name ? { ...ts, enabled: next } : ts,
        ),
      );
      setToolsetBusy(toolset.name);
      try {
        await window.hermesAPI.setDashboardToolsetEnabled(
          toolset.name,
          next,
          profile,
        );
      } catch (err) {
        setToolsets((prev) =>
          prev.map((ts) =>
            ts.name === toolset.name ? { ...ts, enabled: !next } : ts,
          ),
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setToolsetBusy(null);
      }
    },
    [profile],
  );

  const openSkillDetail = useCallback(
    async (skill: DashboardSkill): Promise<void> => {
      setDetailSkill(skill);
      setSkillContent("");
      try {
        // Resolve the local SKILL.md path via the installed-skills list (the
        // REST payload has no filesystem path).
        const installed = await window.hermesAPI.listInstalledSkills(profile);
        const match = installed.find((s) => s.name === skill.name);
        if (match) {
          setSkillContent(await window.hermesAPI.getSkillContent(match.path));
        }
      } catch {
        /* leave detail content empty */
      }
    },
    [profile],
  );

  // ── MCP handlers ────────────────────────────────────────────────────────

  async function reloadMcp(): Promise<void> {
    setMcpError("");
    try {
      setMcpServers(await window.hermesAPI.listMcpServers(profile));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpLoadFailed"));
    }
  }

  function resetMcpModalMode(): void {
    setMcpEditMode("visual");
    setMcpJsonText("");
    setMcpJsonError("");
  }

  function openAddMcp(): void {
    setEditingMcpName(null);
    setEditingEnabled(true);
    setAddForm(EMPTY_ADD_FORM);
    setMcpError("");
    resetMcpModalMode();
    setShowAddMcp(true);
  }

  function openEditMcp(server: McpServer): void {
    setEditingMcpName(server.name);
    setEditingEnabled(server.enabled);
    setAddForm({
      name: server.name,
      type: server.type === "stdio" ? "stdio" : "http",
      url: server.url || "",
      command: server.command || "",
      argsText: (server.args || []).join("\n"),
      envText: Object.entries(server.env || {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      auth: server.auth || "",
    });
    setMcpError("");
    resetMcpModalMode();
    setShowAddMcp(true);
  }

  function closeMcpModal(): void {
    setShowAddMcp(false);
    setEditingMcpName(null);
    setAddForm(EMPTY_ADD_FORM);
    resetMcpModalMode();
  }

  function switchMcpMode(mode: "visual" | "json"): void {
    if (mode === mcpEditMode) return;
    if (mode === "json") {
      setMcpJsonText(formToJson(addForm, editingEnabled));
      setMcpJsonError("");
      setMcpEditMode("json");
      return;
    }
    const parsed = parseServerJson(mcpJsonText);
    if ("error" in parsed) {
      setMcpJsonError(parsed.error);
      return;
    }
    setAddForm((prev) => ({ ...prev, ...parsed.form }));
    if (parsed.enabled !== undefined) setEditingEnabled(parsed.enabled);
    setMcpJsonError("");
    setMcpEditMode("visual");
  }

  async function handleSaveMcp(): Promise<void> {
    const editing = editingMcpName;
    let input: McpServerInput;
    let nextEnabled: boolean | undefined;
    if (mcpEditMode === "json") {
      const parsed = parseServerJson(mcpJsonText);
      if ("error" in parsed) {
        setMcpJsonError(parsed.error);
        return;
      }
      input = formToInput({ ...parsed.form, name: addForm.name });
      nextEnabled = parsed.enabled;
    } else {
      input = formToInput(addForm);
    }
    setMcpError("");
    setMcpMessage("");
    setMcpBusy(editing ? "update" : "add");
    try {
      const result = editing
        ? await window.hermesAPI.updateMcpServer(editing, input, profile)
        : await window.hermesAPI.addMcpServer(input, profile);
      if (!result.success) {
        setMcpError(
          result.error ||
            t(editing ? "tools.mcpUpdateFailed" : "tools.mcpAddFailed"),
        );
        return;
      }
      if (nextEnabled !== undefined && nextEnabled !== editingEnabled) {
        await window.hermesAPI.setMcpServerEnabled(
          input.name,
          nextEnabled,
          profile,
        );
      }
      closeMcpModal();
      setMcpMessage(t(editing ? "tools.mcpUpdated" : "tools.mcpAdded"));
      await reloadMcp();
    } catch (err) {
      setMcpError(
        (err as Error).message ||
          t(editing ? "tools.mcpUpdateFailed" : "tools.mcpAddFailed"),
      );
    } finally {
      setMcpBusy("");
    }
  }

  async function handleRemoveMcp(name: string): Promise<void> {
    if (!window.confirm(t("tools.mcpRemoveConfirm", { name }))) return;
    setMcpBusy(`remove:${name}`);
    try {
      const result = await window.hermesAPI.removeMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpRemoveFailed"));
        return;
      }
      setMcpMessage(t("tools.mcpRemoved"));
      await reloadMcp();
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpRemoveFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  async function handleMcpEnabled(name: string, enabled: boolean): Promise<void> {
    setMcpBusy(`toggle:${name}`);
    setMcpServers((prev) =>
      prev.map((server) =>
        server.name === name ? { ...server, enabled } : server,
      ),
    );
    try {
      const result = await window.hermesAPI.setMcpServerEnabled(
        name,
        enabled,
        profile,
      );
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpToggleFailed"));
        await reloadMcp();
        return;
      }
      setMcpMessage(enabled ? t("tools.mcpEnabled") : t("tools.mcpDisabled"));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpToggleFailed"));
      await reloadMcp();
    } finally {
      setMcpBusy("");
    }
  }

  async function handleTestMcp(name: string): Promise<void> {
    setMcpBusy(`test:${name}`);
    setMcpError("");
    setMcpMessage("");
    try {
      const result = await window.hermesAPI.testMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpTestFailed"));
        return;
      }
      setMcpMessage(
        t("tools.mcpTestPassed", { count: result.tools?.length || 0 }),
      );
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpTestFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  const filteredMcpServers = mcpSearch.trim()
    ? mcpServers.filter((s) => {
        const q = mcpSearch.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q)
        );
      })
    : mcpServers;

  // ── Hub search + actions ────────────────────────────────────────────────

  useEffect(() => {
    if (tab !== "hub") return;
    const q = query.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q) {
      setHubResults([]);
      setHubSearching(false);
      return undefined;
    }
    setHubSearching(true);
    searchTimer.current = setTimeout(() => {
      void window.hermesAPI
        .searchHubSkills(q, "all", 20, profile)
        .then((data) => {
          setHubResults(data.results);
          setHubInstalled(data.installed);
          setHubSearching(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setHubSearching(false);
        });
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [tab, query, profile]);

  const openHubPreview = useCallback(
    async (skill: HubSkill): Promise<void> => {
      setHubPreview(null);
      setHubScan(null);
      try {
        const data = await window.hermesAPI.previewHubSkill(
          skill.identifier,
          profile,
        );
        setHubPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [profile],
  );

  const runHubScan = useCallback(
    async (identifier: string): Promise<void> => {
      setHubScanning(true);
      try {
        setHubScan(await window.hermesAPI.scanHubSkill(identifier, profile));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setHubScanning(false);
      }
    },
    [profile],
  );

  const handleHubInstall = useCallback(
    async (identifier: string): Promise<void> => {
      setHubBusy(identifier);
      try {
        const res = await window.hermesAPI.installHubSkill(identifier, profile);
        if (!res.success && res.error) setError(res.error);
        else {
          setHubInstalled((prev) => ({
            ...prev,
            [identifier]: { name: identifier },
          }));
          setHubPreview(null);
          void load();
        }
      } finally {
        setHubBusy(null);
      }
    },
    [profile, load],
  );

  const handleHubUninstall = useCallback(
    async (name: string, identifier: string): Promise<void> => {
      setHubBusy(identifier);
      try {
        const res = await window.hermesAPI.uninstallHubSkill(name, profile);
        if (!res.success && res.error) setError(res.error);
        else {
          const next = { ...hubInstalled };
          delete next[identifier];
          setHubInstalled(next);
          void load();
        }
      } finally {
        setHubBusy(null);
      }
    },
    [profile, hubInstalled, load],
  );

  const handleUpdateAll = useCallback(async (): Promise<void> => {
    setUpdatingAll(true);
    try {
      const res = await window.hermesAPI.updateHubSkills(profile);
      if (!res.success && res.error) setError(res.error);
    } finally {
      setUpdatingAll(false);
    }
  }, [profile]);

  const searchVisible = tab !== "mcp";

  return (
    <div className="cap-container">
      <div className="cap-header">
        <div>
          <h1 className="cap-title">{t("capabilities.title")}</h1>
          <p className="cap-subtitle">{t("capabilities.subtitle")}</p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <Refresh size={14} />
          {t("capabilities.refresh")}
        </button>
      </div>

      <div className="cap-tabs">
        <button
          type="button"
          className={`cap-tab ${tab === "skills" ? "active" : ""}`}
          onClick={() => setTab("skills")}
        >
          {t("capabilities.tabs.skills")}
          <span className="cap-tab-count">{skills.length}</span>
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "toolsets" ? "active" : ""}`}
          onClick={() => setTab("toolsets")}
        >
          {t("capabilities.tabs.toolsets")}
          <span className="cap-tab-count">{toolsets.length}</span>
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "mcp" ? "active" : ""}`}
          onClick={() => setTab("mcp")}
        >
          {t("capabilities.tabs.mcp")}
        </button>
        <button
          type="button"
          className={`cap-tab ${tab === "hub" ? "active" : ""}`}
          onClick={() => setTab("hub")}
        >
          {t("capabilities.tabs.hub")}
        </button>
      </div>

      {searchVisible && (
        <div className="cap-search">
          <Search size={15} />
          <input
            className="cap-search-input"
            value={query}
            placeholder={
              tab === "skills"
                ? t("capabilities.searchSkills")
                : tab === "toolsets"
                  ? t("capabilities.searchToolsets")
                  : t("capabilities.searchHub")
            }
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="btn-ghost cap-search-clear"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {error && <div className="cap-error">{error}</div>}

      {loading ? (
        <div className="cap-state">
          <OrbLoader state="searching" size={64} />
        </div>
      ) : tab === "skills" ? (
        <div className="cap-master-detail">
          <div className="cap-list">
            {filteredSkills.length === 0 ? (
              <div className="cap-empty">{t("capabilities.noSkills")}</div>
            ) : (
              filteredSkills.map((skill) => (
                <div
                  key={skill.name}
                  className={`cap-row ${
                    detailSkill?.name === skill.name ? "active" : ""
                  }`}
                  onClick={() => void openSkillDetail(skill)}
                >
                  <div className="cap-row-main">
                    <div className="cap-row-title">{skill.name}</div>
                    <div className="cap-row-sub">
                      {skill.category}
                      <span className="cap-provenance">
                        {t(`capabilities.provenance.${skill.provenance}`) ??
                          skill.provenance}
                      </span>
                      {skill.usage > 0 && (
                        <span className="cap-usage">×{skill.usage}</span>
                      )}
                    </div>
                  </div>
                  <label
                    className="cap-toggle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      disabled={skillBusy === skill.name}
                      onChange={() => void handleToggleSkill(skill)}
                    />
                    <span className="cap-toggle-track" />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="cap-detail">
            {detailSkill ? (
              <div className="cap-detail-inner">
                <div className="cap-detail-title">{detailSkill.name}</div>
                <div className="cap-detail-meta">
                  <span className="cap-pill">{detailSkill.category}</span>
                  <span className="cap-pill cap-pill--muted">
                    {t(`capabilities.provenance.${detailSkill.provenance}`) ??
                      detailSkill.provenance}
                  </span>
                </div>
                <p className="cap-detail-desc">{detailSkill.description}</p>
                <div className="cap-detail-content">
                  {skillContent ? (
                    <AgentMarkdown>{skillContent}</AgentMarkdown>
                  ) : (
                    <div className="cap-empty">
                      {t("capabilities.emptyState")}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="cap-detail-empty">
                {t("capabilities.skillDetail")}
              </div>
            )}
          </div>
        </div>
      ) : tab === "toolsets" ? (
        <div className="cap-master-detail">
          <div className="cap-list">
            {filteredToolsets.length === 0 ? (
              <div className="cap-empty">{t("capabilities.noToolsets")}</div>
            ) : (
              filteredToolsets.map((toolset) => (
                <div
                  key={toolset.name}
                  className={`cap-row ${
                    detailToolset?.name === toolset.name ? "active" : ""
                  }`}
                  onClick={() => setDetailToolset(toolset)}
                >
                  <div className="cap-row-main">
                    <div className="cap-row-title">{toolset.label}</div>
                    <div className="cap-row-sub">
                      {toolset.description}
                      {!toolset.configured && (
                        <span className="cap-pill cap-pill--warn">
                          {t("capabilities.needsKeys")}
                        </span>
                      )}
                    </div>
                  </div>
                  <label
                    className="cap-toggle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={toolset.enabled}
                      disabled={toolsetBusy === toolset.name}
                      onChange={() => void handleToggleToolset(toolset)}
                    />
                    <span className="cap-toggle-track" />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="cap-detail">
            {detailToolset ? (
              <div className="cap-detail-inner">
                <div className="cap-detail-title">{detailToolset.label}</div>
                <p className="cap-detail-desc">{detailToolset.description}</p>
                <div className="cap-tool-chips">
                  {detailToolset.tools.map((tool) => (
                    <span key={tool} className="cap-tool-chip">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="cap-detail-empty">
                {t("capabilities.toolsetDetail")}
              </div>
            )}
          </div>
        </div>
      ) : tab === "mcp" ? (
        <div className="tools-section">
          <div className="tools-header tools-header-row">
            <div className="tools-mcp-search">
              <Search size={15} />
              <input
                className="tools-mcp-search-input"
                type="text"
                placeholder={t("tools.mcpSearch")}
                value={mcpSearch}
                onChange={(e) => setMcpSearch(e.target.value)}
              />
              {mcpSearch && (
                <button
                  type="button"
                  className="tools-icon-btn"
                  aria-label={t("tools.close")}
                  onClick={() => setMcpSearch("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="tools-header-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void reloadMcp()}
              >
                <TinyIcon kind="refresh" />
                {t("tools.refresh")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openAddMcp}
              >
                <TinyIcon kind="plus" />
                {t("tools.mcpAddServer")}
              </button>
            </div>
          </div>

          {mcpError && <div className="tools-error">{mcpError}</div>}
          {mcpMessage && <div className="tools-success">{mcpMessage}</div>}

          {mcpServers.length === 0 ? (
            <div className="tools-empty">
              <div className="tools-card-icon">
                <TinyIcon kind="server" />
              </div>
              <div>
                <div className="tools-card-label">
                  {t("tools.mcpEmptyTitle")}
                </div>
                <div className="tools-card-description">
                  {t("tools.mcpEmptyDescription")}
                </div>
              </div>
            </div>
          ) : filteredMcpServers.length === 0 ? (
            <div className="tools-card-description tools-mcp-no-results">
              {t("tools.mcpNoResults")}
            </div>
          ) : (
            <div className="mcp-table">
              <div className="mcp-thead">
                <span>{t("tools.mcpColServer")}</span>
                <span>{t("tools.mcpColTransport")}</span>
                <span>{t("tools.mcpColCommand")}</span>
                <span className="mcp-th-enabled">
                  {t("tools.mcpColEnabled")}
                </span>
              </div>
              {filteredMcpServers.map((s) => {
                const cmd =
                  s.type === "http"
                    ? s.url || ""
                    : [s.command, ...(s.args || [])].filter(Boolean).join(" ");
                return (
                  <div
                    key={s.name}
                    className={`mcp-row ${s.enabled ? "" : "mcp-row-off"}`}
                  >
                    <div className="mcp-cell mcp-cell-server">
                      <div className="tools-card-icon">
                        <TinyIcon kind="server" />
                      </div>
                      <span className="mcp-name">{s.name}</span>
                    </div>
                    <div className="mcp-cell">
                      <span
                        className={`mcp-transport ${
                          s.type === "http" ? "is-http" : ""
                        }`}
                      >
                        {s.type === "http"
                          ? t("tools.http")
                          : s.type === "stdio"
                            ? t("tools.stdio")
                            : t("tools.unknown")}
                      </span>
                    </div>
                    <div className="mcp-cell mcp-cell-cmd" title={cmd}>
                      <span className="mcp-cmd">
                        {cmd || t("tools.mcpNoDetail")}
                      </span>
                    </div>
                    <div className="mcp-cell mcp-cell-controls">
                      <div className="mcp-row-actions">
                        <button
                          type="button"
                          className="tools-icon-btn"
                          title={t("tools.mcpEdit")}
                          aria-label={t("tools.mcpEdit")}
                          disabled={mcpBusy === `test:${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditMcp(s);
                          }}
                        >
                          <TinyIcon kind="edit" />
                        </button>
                        <button
                          type="button"
                          className="tools-icon-btn"
                          title={t("tools.mcpTest")}
                          aria-label={t("tools.mcpTest")}
                          disabled={mcpBusy === `test:${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleTestMcp(s.name);
                          }}
                        >
                          <TinyIcon kind="test" />
                        </button>
                        <button
                          type="button"
                          className="tools-icon-btn tools-icon-btn-danger"
                          title={t("tools.mcpRemove")}
                          aria-label={t("tools.mcpRemove")}
                          disabled={mcpBusy === `remove:${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRemoveMcp(s.name);
                          }}
                        >
                          <TinyIcon kind="trash" />
                        </button>
                      </div>
                      <label
                        className="tools-toggle"
                        title={
                          s.enabled
                            ? t("tools.mcpDisable")
                            : t("tools.mcpEnable")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          disabled={mcpBusy === `toggle:${s.name}`}
                          onChange={() =>
                            void handleMcpEnabled(s.name, !s.enabled)
                          }
                        />
                        <span className="tools-toggle-track" />
                      </label>
                    </div>
                  </div>
                );
              })}
              <div className="mcp-tfoot">
                <span>
                  {t("tools.mcpFooter", {
                    servers: mcpServers.length,
                    enabled: mcpServers.filter((s) => s.enabled).length,
                  })}
                </span>
                <span className="mcp-tfoot-hint">
                  {t("tools.mcpActionsHint")}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="cap-hub">
          <div className="cap-hub-sources">
            <span className="cap-hub-sources-label">
              {t("capabilities.hubSources")}
            </span>
            <div className="cap-hub-chips">
              {(hubSources?.sources ?? []).map((source) => {
                const degraded =
                  source.available === false || source.rateLimited === true;
                return (
                  <span
                    key={source.id}
                    className={`cap-hub-chip ${
                      degraded ? "cap-hub-chip--degraded" : ""
                    }`}
                  >
                    {source.label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="cap-hub-toolbar">
            <span className="cap-hub-count">
              {query.trim()
                ? t("capabilities.resultCount", { count: hubResults.length })
                : t("capabilities.featured")}
              {hubSearching && (
                <span className="cap-hub-searching">
                  {" "}
                  {t("capabilities.searching")}
                </span>
              )}
            </span>
            {Object.keys(hubInstalled).length > 0 && (
              <button
                className="btn-ghost btn-sm"
                disabled={updatingAll}
                onClick={() => void handleUpdateAll()}
              >
                {updatingAll
                  ? t("capabilities.updating")
                  : t("capabilities.updateAll")}
              </button>
            )}
          </div>

          <div className="cap-hub-list">
            {hubSearching ? (
              <div className="cap-state">
                <OrbLoader state="searching" size={48} />
              </div>
            ) : (
              (query.trim() ? hubResults : hubSources?.featured ?? []).map(
                (skill) => {
                  const installed = Boolean(hubInstalled[skill.identifier]);
                  const busy = hubBusy === skill.identifier;
                  return (
                    <div key={skill.identifier} className="cap-hub-row">
                      <div className="cap-hub-row-main">
                        <div className="cap-hub-row-title">
                          <span className="cap-hub-name">{skill.name}</span>
                          <span className={trustTone(skill.trustLevel)}>
                            {t(`capabilities.trust.${skill.trustLevel}`) ??
                              skill.trustLevel}
                          </span>
                          {installed && (
                            <span className="cap-hub-installed">
                              {t("capabilities.installed")}
                            </span>
                          )}
                        </div>
                        <p className="cap-hub-desc">{skill.description}</p>
                      </div>
                      <div className="cap-hub-row-actions">
                        <button
                          className="btn-ghost btn-sm cap-hub-preview-btn"
                          onClick={() => void openHubPreview(skill)}
                        >
                          {t("capabilities.preview")}
                        </button>
                        {installed ? (
                          <button
                            className="btn-ghost btn-sm cap-hub-uninstall-btn"
                            disabled={busy}
                            onClick={() =>
                              void handleHubUninstall(
                                hubInstalled[skill.identifier].name,
                                skill.identifier,
                              )
                            }
                          >
                            {busy
                              ? t("capabilities.uninstalling")
                              : t("capabilities.uninstall")}
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void handleHubInstall(skill.identifier)}
                          >
                            {busy
                              ? t("capabilities.installing")
                              : t("capabilities.install")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                },
              )
            )}
            {!hubSearching &&
              (query.trim()
                ? hubResults.length === 0
                : (hubSources?.featured ?? []).length === 0) && (
                <div className="cap-empty">
                  {query.trim()
                    ? t("capabilities.noHubResults")
                    : t("capabilities.hubLanding")}
                </div>
              )}
          </div>

          {hubPreview && (
            <div
              className="models-modal-overlay"
              onClick={() => setHubPreview(null)}
            >
              <div
                className="models-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="models-modal-header">
                  <div className="cap-hub-preview-title">
                    <span className="cap-hub-name">{hubPreview.name}</span>
                    <span className={trustTone(hubPreview.trustLevel)}>
                      {t(`capabilities.trust.${hubPreview.trustLevel}`) ??
                        hubPreview.trustLevel}
                    </span>
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={() => setHubPreview(null)}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="models-modal-body">
                  <p className="cap-hub-preview-identifier">
                    {hubPreview.identifier}
                  </p>
                  {hubPreview.description && (
                    <p className="cap-detail-desc">{hubPreview.description}</p>
                  )}

                  {hubScan && (
                    <div className="cap-hub-scan">
                      <div
                        className={`cap-hub-scan-verdict cap-hub-scan-verdict--${hubScan.verdict}`}
                      >
                        {t(`capabilities.verdict.${hubScan.verdict}`) ??
                          hubScan.verdict}
                        {" · "}
                        {t(`capabilities.policy.${hubScan.policy}`) ??
                          hubScan.policy}
                      </div>
                      <div className="cap-hub-scan-findings">
                        {hubScan.findings.length === 0
                          ? t("capabilities.noFindings")
                          : hubScan.findings.map((f, i) => (
                              <div key={i} className="cap-hub-scan-finding">
                                [{f.severity}] {f.file}
                                {f.line !== null ? `:${f.line}` : ""} —{" "}
                                {f.description}
                              </div>
                            ))}
                      </div>
                    </div>
                  )}

                  {hubPreview.skillMd ? (
                    <pre className="cap-hub-preview-md">
                      {hubPreview.skillMd}
                    </pre>
                  ) : (
                    <div className="cap-empty">
                      {t("capabilities.noReadme")}
                    </div>
                  )}
                  {hubPreview.files.length > 0 && (
                    <div className="cap-hub-preview-files">
                      {t("capabilities.files")}: {hubPreview.files.join(", ")}
                    </div>
                  )}
                </div>
                <div className="models-modal-footer">
                  <button
                    className="btn btn-secondary btn-sm cap-hub-scan-btn"
                    disabled={hubScanning}
                    onClick={() => void runHubScan(hubPreview.identifier)}
                  >
                    {hubScanning
                      ? t("capabilities.scanning")
                      : t("capabilities.scan")}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={
                      Boolean(hubInstalled[hubPreview.identifier]) ||
                      hubBusy === hubPreview.identifier
                    }
                    onClick={() => void handleHubInstall(hubPreview.identifier)}
                  >
                    {hubInstalled[hubPreview.identifier]
                      ? t("capabilities.installed")
                      : hubBusy === hubPreview.identifier
                        ? t("capabilities.installing")
                        : t("capabilities.install")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showAddMcp && (
        <div className="models-modal-overlay" onClick={closeMcpModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingMcpName
                  ? t("tools.mcpEditServer")
                  : t("tools.mcpAddServer")}
              </h2>
              <button
                type="button"
                className="tools-icon-btn"
                aria-label={t("tools.close")}
                onClick={closeMcpModal}
              >
                <TinyIcon kind="x" />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("tools.mcpName")}
                </label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="github"
                />
              </div>

              <div className="mcp-mode-toggle">
                <button
                  type="button"
                  className={`mcp-mode-btn ${
                    mcpEditMode === "visual" ? "active" : ""
                  }`}
                  onClick={() => switchMcpMode("visual")}
                >
                  {t("tools.mcpModeVisual")}
                </button>
                <button
                  type="button"
                  className={`mcp-mode-btn ${
                    mcpEditMode === "json" ? "active" : ""
                  }`}
                  onClick={() => switchMcpMode("json")}
                >
                  {t("tools.mcpModeJson")}
                </button>
              </div>

              {mcpEditMode === "visual" && (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("tools.mcpTransport")}
                    </label>
                    <select
                      className="input"
                      value={addForm.type}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          type: e.target.value as "http" | "stdio",
                        }))
                      }
                    >
                      <option value="http">{t("tools.http")}</option>
                      <option value="stdio">{t("tools.stdio")}</option>
                    </select>
                  </div>
                  {addForm.type === "http" ? (
                    <>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpUrl")}
                        </label>
                        <input
                          className="input"
                          value={addForm.url}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              url: e.target.value,
                            }))
                          }
                          placeholder="https://example.com/mcp"
                        />
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpAuth")}
                        </label>
                        <select
                          className="input"
                          value={addForm.auth}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              auth: e.target.value,
                            }))
                          }
                        >
                          <option value="">{t("tools.mcpAuthNone")}</option>
                          <option value="oauth">OAuth</option>
                          <option value="header">
                            {t("tools.mcpAuthHeader")}
                          </option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpCommand")}
                        </label>
                        <input
                          className="input"
                          value={addForm.command}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              command: e.target.value,
                            }))
                          }
                          placeholder="npx"
                        />
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpArgs")}
                        </label>
                        <textarea
                          className="input tools-textarea"
                          value={addForm.argsText}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              argsText: e.target.value,
                            }))
                          }
                          placeholder={"-y\n@modelcontextprotocol/server-github"}
                        />
                        <span className="models-modal-hint">
                          {t("tools.mcpArgsHint")}
                        </span>
                      </div>
                      <div className="models-modal-field">
                        <label className="models-modal-label">
                          {t("tools.mcpEnv")}
                        </label>
                        <textarea
                          className="input tools-textarea"
                          value={addForm.envText}
                          onChange={(e) =>
                            setAddForm((prev) => ({
                              ...prev,
                              envText: e.target.value,
                            }))
                          }
                          placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..."
                        />
                        <span className="models-modal-hint">
                          {t("tools.mcpEnvHint")}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}

              {mcpEditMode === "json" && (
                <div className="models-modal-field">
                  <label className="models-modal-label">
                    {t("tools.mcpJsonLabel")}
                  </label>
                  <textarea
                    className="input tools-textarea mcp-json-input"
                    value={mcpJsonText}
                    spellCheck={false}
                    onChange={(e) => {
                      setMcpJsonText(e.target.value);
                      setMcpJsonError("");
                    }}
                  />
                  {mcpJsonError && (
                    <span className="models-modal-hint mcp-json-error">
                      {mcpJsonError}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="models-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={closeMcpModal}
              >
                {t("tools.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={mcpBusy === (editingMcpName ? "update" : "add")}
                onClick={() => void handleSaveMcp()}
              >
                {editingMcpName
                  ? t("tools.mcpSaveChanges")
                  : t("tools.mcpAddServer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
