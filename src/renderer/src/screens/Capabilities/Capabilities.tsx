import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Refresh, X } from "../../assets/icons";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import type {
  DashboardSkill,
  DashboardToolset,
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

  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab.tab);
  }, [focusTab]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [s, ts] = await Promise.all([
        window.hermesAPI.getDashboardSkills(profile),
        window.hermesAPI.getDashboardToolsets(profile),
      ]);
      setSkills(s);
      setToolsets(ts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <div className="cap-empty">{t("capabilities.tabs.mcp")}</div>
      ) : (
        <div className="cap-empty">{t("capabilities.tabs.hub")}</div>
      )}
    </div>
  );
}
