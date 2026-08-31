import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus,
  ChatBubble,
  Pencil,
  X,
  Bot,
  Search,
  Check,
} from "../../assets/icons";
import { Brain, Sliders, Radio } from "lucide-react";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import { useProfileModal } from "../../components/profile/ProfileModalContext";

interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  color?: string;
  avatar?: string | null;
  description?: string;
}

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function providerLabel(provider: string): string {
  if (!provider) return "Not set";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  return provider.replace(/^9r-/, "9R ").replace(/-/g, " ");
}

export function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  // New Bot Form State
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  const [cloneSource, setCloneSource] = useState("default");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [startingProfile, setStartingProfile] = useState<string | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
    if (!selectedBotId && list.length > 0) {
      const active = list.find((p) => p.id === activeProfile) || list[0];
      setSelectedBotId(active.id);
    }
  }, [activeProfile, selectedBotId]);

  const gatewayPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGatewayPoll = useCallback((): void => {
    if (gatewayPollRef.current) {
      clearTimeout(gatewayPollRef.current);
      gatewayPollRef.current = null;
    }
  }, []);

  const pollGatewayReady = useCallback(
    (name: string): void => {
      stopGatewayPoll();
      let attemptsLeft = 15;
      const settle = (): void =>
        setStartingProfile((current) => (current === name ? null : current));
      const tick = async (): Promise<void> => {
        attemptsLeft -= 1;
        try {
          const list = await window.hermesAPI.listProfiles();
          setProfiles(list);
          if (list.find((p) => p.id === name)?.gatewayRunning) {
            settle();
            return;
          }
        } catch {}
        if (attemptsLeft <= 0) {
          settle();
          return;
        }
        gatewayPollRef.current = setTimeout(tick, 700);
      };
      gatewayPollRef.current = setTimeout(tick, 700);
    },
    [stopGatewayPoll],
  );

  useEffect(() => {
    void loadProfiles();
    return stopGatewayPoll;
  }, [loadProfiles, stopGatewayPoll]);

  const handleSelect = useCallback(
    async (name: string): Promise<void> => {
      setSelectedBotId(name);
      if (name === activeProfile) return;
      setError("");
      setStartingProfile(name);
      try {
        const ok = await window.hermesAPI.setActiveProfile(name);
        if (!ok) {
          setError(t("agents.selectFailed"));
          setStartingProfile(null);
          return;
        }
        onSelectProfile(name);
        await loadProfiles();
        pollGatewayReady(name);
      } catch (err) {
        setError((err as Error).message);
        setStartingProfile(null);
      }
    },
    [activeProfile, onSelectProfile, loadProfiles, pollGatewayReady, t],
  );

  const handleChatWith = useCallback(
    (name: string): void => {
      onChatWith(name);
    },
    [onChatWith],
  );

  const openCreate = (): void => {
    setNewName("");
    setCloneConfig(true);
    setCloneSource(activeProfile || "default");
    setError("");
    setShowCreate(true);
  };

  const closeCreate = (): void => {
    setShowCreate(false);
    setError("");
  };

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError(t("agents.errorNameRequired"));
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await window.hermesAPI.createProfile(
        trimmed,
        cloneConfig ? cloneSource : null,
      );
      if (!res.success) {
        setError(res.error || t("agents.errorCreateFailed"));
        return;
      }
      closeCreate();
      await loadProfiles();
      handleSelect(trimmed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    const q = searchQuery.toLowerCase();
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.provider.toLowerCase().includes(q),
    );
  }, [profiles, searchQuery]);

  const selectedBot = useMemo(() => {
    return profiles.find((p) => p.id === selectedBotId) || profiles[0] || null;
  }, [profiles, selectedBotId]);

  if (loading) {
    return (
      <div className="agents-container agents-loading">
        <OrbLoader state="searching" size={64} />
      </div>
    );
  }

  return (
    <div className="bot-roster-layout">
      {/* ── Left Column: Bots List & Roster ───────────────────────────────── */}
      <div className="bot-roster-sidebar">
        <div className="bot-roster-header">
          <div className="bot-roster-header-title">
            <Bot size={18} className="bot-roster-icon" />
            <span>{t("navigation.agents")}</span>
            <span className="bot-roster-count">{profiles.length}</span>
          </div>
          <button
            type="button"
            className="bot-roster-btn-new"
            onClick={openCreate}
            title={t("agents.newAgent")}
          >
            <Plus size={15} />
            <span>{t("agents.newAgent")}</span>
          </button>
        </div>

        <div className="bot-roster-search-bar">
          <Search size={14} className="bot-search-icon" />
          <input
            type="text"
            className="bot-search-input"
            placeholder={t("navigation.searchSessions") + "…"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="bot-search-clear"
              onClick={() => setSearchQuery("")}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="bot-roster-list">
          {filteredProfiles.map((p) => {
            const isSelected = selectedBot?.id === p.id;
            const isLiveActive = activeProfile === p.id;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                className={`bot-roster-item ${isSelected ? "selected" : ""} ${
                  isLiveActive ? "active-profile" : ""
                }`}
                onClick={() => setSelectedBotId(p.id)}
                onDoubleClick={() => handleChatWith(p.id)}
              >
                <div className="bot-item-avatar-wrapper">
                  <ProfileAvatar
                    name={p.id}
                    color={p.color}
                    avatar={p.avatar}
                    size={38}
                  />
                  <span
                    className={`bot-status-indicator ${
                      p.gatewayRunning ? "online" : "offline"
                    }`}
                    title={p.gatewayRunning ? "Gateway Active" : "Offline"}
                  />
                </div>

                <div className="bot-item-details">
                  <div className="bot-item-row-top">
                    <span className="bot-item-name">{p.name}</span>
                    {isLiveActive && (
                      <span className="bot-active-badge">Active</span>
                    )}
                  </div>
                  <div className="bot-item-row-bottom">
                    <span className="bot-item-model">
                      {p.model ? p.model.split("/").pop() : "No model"}
                    </span>
                    <span className="bot-item-provider">
                      {providerLabel(p.provider)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right Column: Bot Details & Actions ────────────────────────────── */}
      <div className="bot-roster-content">
        {selectedBot ? (
          <div className="bot-details-card">
            <div className="bot-details-hero">
              <div className="bot-details-avatar-section">
                <ProfileAvatar
                  name={selectedBot.id}
                  color={selectedBot.color}
                  avatar={selectedBot.avatar}
                  size={72}
                />
                <div>
                  <h1 className="bot-details-title">{selectedBot.name}</h1>
                  <div className="bot-details-handle">@{selectedBot.id}</div>
                </div>
              </div>

              <div className="bot-details-hero-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-md"
                  onClick={() =>
                    openProfile(selectedBot.id, {
                      onChanged: loadProfiles,
                      onDeleted: (n) => {
                        if (activeProfile === n) onSelectProfile("default");
                        loadProfiles();
                      },
                    })
                  }
                >
                  <Pencil size={14} />
                  <span>Configure Bot</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  onClick={() => handleChatWith(selectedBot.id)}
                >
                  <ChatBubble size={14} />
                  <span>Open Bot Chat</span>
                </button>
              </div>
            </div>

            <div className="bot-details-grid">
              <div className="bot-info-card">
                <div className="bot-info-card-header">
                  <Sliders size={16} />
                  <span>Runtime Configuration</span>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Active Model</span>
                  <code className="bot-info-code">
                    {selectedBot.model || "Default fallback"}
                  </code>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Provider</span>
                  <span className="bot-info-val">
                    {providerLabel(selectedBot.provider)}
                  </span>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Gateway Status</span>
                  <span
                    className={`bot-pill ${
                      selectedBot.gatewayRunning ? "pill-on" : "pill-off"
                    }`}
                  >
                    <span className="bot-pill-dot" />
                    {selectedBot.gatewayRunning ? "Running" : "Offline"}
                  </span>
                </div>
              </div>

              <div className="bot-info-card">
                <div className="bot-info-card-header">
                  <Brain size={16} />
                  <span>Skills & Capabilities</span>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Installed Skills</span>
                  <span className="bot-info-val">
                    {selectedBot.skillCount} active
                  </span>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Custom Persona / Soul</span>
                  <span className="bot-info-val">
                    {selectedBot.hasSoul ? (
                      <span className="text-success flex items-center gap-1">
                        <Check size={14} /> Yes
                      </span>
                    ) : (
                      "Default"
                    )}
                  </span>
                </div>
                <div className="bot-info-row">
                  <span className="bot-info-label">Environment (.env)</span>
                  <span className="bot-info-val">
                    {selectedBot.hasEnv ? "Custom keys set" : "Shared"}
                  </span>
                </div>
              </div>
            </div>

            {/* Switch Active Profile Section */}
            <div className="bot-footer-switch-box">
              <div className="bot-switch-desc">
                <strong>System Workspace Context:</strong>{" "}
                {activeProfile === selectedBot.id ? (
                  <span className="text-success">
                    Currently set as active system profile
                  </span>
                ) : (
                  <span>
                    Switching system context repoints background CLI and gateway
                    to this bot.
                  </span>
                )}
              </div>
              {activeProfile !== selectedBot.id && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSelect(selectedBot.id)}
                  disabled={startingProfile === selectedBot.id}
                >
                  <Radio size={13} />
                  <span>
                    {startingProfile === selectedBot.id
                      ? "Activating…"
                      : "Make Active Profile"}
                  </span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bot-roster-empty">
            <Bot size={48} className="bot-empty-icon" />
            <h3>No Bot Selected</h3>
            <p>Choose a bot from the roster on the left or create a new one.</p>
          </div>
        )}
      </div>

      {/* ── Create New Bot Modal ────────────────────────────────────────── */}
      <AppModal
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
        className="agents-create-modal"
        labelledBy="agents-create-title"
      >
        <div className="agents-create-modal-header">
          <AppModalTitle
            id="agents-create-title"
            className="agents-create-modal-title"
          >
            Create New Bot
          </AppModalTitle>
          <button
            className="profile-modal-close"
            onClick={closeCreate}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="agents-create-modal-body">
          <label className="agents-create-field">
            <span>Bot Name / Identifier</span>
            <input
              className="input"
              placeholder="e.g. coding-assistant, research-bot"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </label>
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>Clone base settings & provider keys from</span>
            <select
              className="select"
              value={cloneSource}
              onChange={(e) => setCloneSource(e.target.value)}
              disabled={!cloneConfig}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
          </label>
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-actions">
            <button className="btn btn-secondary" onClick={closeCreate}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : "Create Bot"}
            </button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}

export default Agents;
