import { useEffect, useState } from "react";
import {
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/**
 * Security pane — command approval, deny/allowlist rules, write-approval
 * gates, and the working folder. All values round-trip through the agent's
 * `config.yaml` via the `get-config` / `set-config` IPC (dotted keys):
 *
 *  - `approvals.mode`         manual | smart | off   (command approval)
 *  - `approvals.cron_mode`    approve | prompt       (cron approval)
 *  - `approvals.deny`         list of command globs  (always blocked)
 *  - `command_allowlist`      list of command globs  (always allowed)
 *  - `memory.write_approval`  bool                   (memory write gate)
 *  - `skills.write_approval`  bool                   (skill write gate)
 *  - `terminal.cwd`           string                 (working folder)
 *
 * List values are sent as JSON arrays (`["a","b"]`) — the main-process config
 * writer detects the `[...]` shape and stores a YAML block list.
 */
export default function SecurityPane(): React.JSX.Element {
  const { t } = useI18n();
  const { profile } = useSettings();

  // Command approval mode (manual | smart | off)
  const [approvalMode, setApprovalMode] = useState("manual");
  const [approvalModeLoaded, setApprovalModeLoaded] = useState(false);
  // Cron approval (approve | prompt)
  const [cronMode, setCronMode] = useState("approve");
  const [cronModeLoaded, setCronModeLoaded] = useState(false);
  // Deny rules + allowlist (comma-separated lines in the textarea)
  const [denyText, setDenyText] = useState("");
  const [denyLoaded, setDenyLoaded] = useState(false);
  const [allowlistText, setAllowlistText] = useState("");
  const [allowlistLoaded, setAllowlistLoaded] = useState(false);
  // Write-approval gates
  const [memoryWriteApproval, setMemoryWriteApproval] = useState(false);
  const [memoryWriteLoaded, setMemoryWriteLoaded] = useState(false);
  const [skillsWriteApproval, setSkillsWriteApproval] = useState(false);
  const [skillsWriteLoaded, setSkillsWriteLoaded] = useState(false);
  // Working folder
  const [workDir, setWorkDir] = useState("");
  const [workDirLoaded, setWorkDirLoaded] = useState(false);

  // Save feedback
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const api = window.hermesAPI;

  useEffect(() => {
    void api.getConfig("approvals.mode", profile).then((v) => {
      if (v === "smart" || v === "off" || v === "manual") {
        setApprovalMode(v);
      }
      setApprovalModeLoaded(true);
    });
    void api.getConfig("approvals.cron_mode", profile).then((v) => {
      if (v === "approve" || v === "prompt") setCronMode(v);
      setCronModeLoaded(true);
    });
    void api.getConfig("approvals.deny", profile).then((v) => {
      setDenyText(parseList(v));
      setDenyLoaded(true);
    });
    void api.getConfig("command_allowlist", profile).then((v) => {
      setAllowlistText(parseList(v));
      setAllowlistLoaded(true);
    });
    void api.getConfig("memory.write_approval", profile).then((v) => {
      setMemoryWriteApproval(v === "true" || v === "True" || v === "1");
      setMemoryWriteLoaded(true);
    });
    void api.getConfig("skills.write_approval", profile).then((v) => {
      setSkillsWriteApproval(v === "true" || v === "True" || v === "1");
      setSkillsWriteLoaded(true);
    });
    void api.getConfig("terminal.cwd", profile).then((v) => {
      setWorkDir(v || "");
      setWorkDirLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  /** Config stores lists as JSON (`["a","b"]`) or null when unset. */
  function parseList(raw: string | null): string {
    if (!raw) return "";
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(String).join("\n");
    } catch {
      /* not JSON — leave empty */
    }
    return "";
  }

  function saveFlash(label: string): void {
    setFlash(label);
    window.setTimeout(() => setFlash(null), 2500);
  }

  async function saveScalar(
    key: string,
    value: string,
    label: string,
  ): Promise<void> {
    setSaving(label);
    try {
      await api.setConfig(key, value, profile);
      saveFlash(label);
    } finally {
      setSaving(null);
    }
  }

  async function saveList(
    key: string,
    text: string,
    label: string,
  ): Promise<void> {
    const items = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    setSaving(label);
    try {
      await api.setConfig(key, JSON.stringify(items), profile);
      saveFlash(label);
    } finally {
      setSaving(null);
    }
  }

  async function pickWorkDir(): Promise<void> {
    const picked = await api.selectFolder();
    if (typeof picked === "string" && picked.length > 0) {
      setWorkDir(picked);
    }
  }

  const modeOptions = [
    { id: "manual", label: t("settings.security.modeManual") },
    { id: "smart", label: t("settings.security.modeSmart") },
    { id: "off", label: t("settings.security.modeOff") },
  ] as const;

  const cronOptions = [
    { id: "approve", label: t("settings.security.cronApprove") },
    { id: "prompt", label: t("settings.security.cronPrompt") },
  ] as const;

  return (
    <div className="settings-modal-pane">
      {flash && <div className="settings-pane-flash">{flash}</div>}

      {/* ── Command approval ─────────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          <ShieldCheck
            size={14}
            style={{ verticalAlign: -2, marginRight: 6 }}
          />
          {t("settings.security.commandApproval")}
        </label>
        {approvalModeLoaded && (
          <div className="settings-theme-options">
            {modeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-theme-option ${
                  approvalMode === opt.id ? "active" : ""
                }`}
                onClick={() => {
                  setApprovalMode(opt.id);
                  void saveScalar(
                    "approvals.mode",
                    opt.id,
                    t("settings.security.savedApprovalMode"),
                  );
                }}
              >
                <span className="settings-mode-option">{opt.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="settings-field-hint">
          {t("settings.security.commandApprovalHint")}
        </div>
      </div>

      {/* ── Cron approval ────────────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.security.cronApproval")}
        </label>
        {cronModeLoaded && (
          <div className="settings-theme-options">
            {cronOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-theme-option ${
                  cronMode === opt.id ? "active" : ""
                }`}
                onClick={() => {
                  setCronMode(opt.id);
                  void saveScalar(
                    "approvals.cron_mode",
                    opt.id,
                    t("settings.security.savedCronMode"),
                  );
                }}
              >
                <span className="settings-mode-option">{opt.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="settings-field-hint">
          {t("settings.security.cronApprovalHint")}
        </div>
      </div>

      {/* ── Deny rules ───────────────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          <ShieldAlert
            size={14}
            style={{ verticalAlign: -2, marginRight: 6 }}
          />
          {t("settings.security.denyRules")}
        </label>
        <textarea
          className="settings-security-textarea"
          rows={4}
          placeholder={t("settings.security.denyPlaceholder")}
          value={denyText}
          disabled={!denyLoaded}
          onChange={(e) => setDenyText(e.target.value)}
        />
        <div className="settings-field-hint">
          {t("settings.security.denyHint")}
        </div>
        <button
          type="button"
          className="settings-security-save"
          disabled={!denyLoaded || saving === "deny"}
          onClick={() =>
            void saveList(
              "approvals.deny",
              denyText,
              t("settings.security.savedDeny"),
            )
          }
        >
          {saving === "deny"
            ? t("settings.security.saving")
            : t("settings.security.saveDeny")}
        </button>
      </div>

      {/* ── Command allowlist ────────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.security.allowlist")}
        </label>
        <textarea
          className="settings-security-textarea"
          rows={4}
          placeholder={t("settings.security.allowlistPlaceholder")}
          value={allowlistText}
          disabled={!allowlistLoaded}
          onChange={(e) => setAllowlistText(e.target.value)}
        />
        <div className="settings-field-hint">
          {t("settings.security.allowlistHint")}
        </div>
        <button
          type="button"
          className="settings-security-save"
          disabled={!allowlistLoaded || saving === "allowlist"}
          onClick={() =>
            void saveList(
              "command_allowlist",
              allowlistText,
              t("settings.security.savedAllowlist"),
            )
          }
        >
          {saving === "allowlist"
            ? t("settings.security.saving")
            : t("settings.security.saveAllowlist")}
        </button>
      </div>

      {/* ── Write-approval gates ─────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.security.writeApproval")}
        </label>
        <div className="settings-field-hint">
          {t("settings.security.writeApprovalHint")}
        </div>
        <div className="settings-security-toggle-row">
          <span>{t("settings.security.memoryWrites")}</span>
          <label className="tools-toggle">
            <input
              type="checkbox"
              checked={memoryWriteApproval}
              disabled={!memoryWriteLoaded}
              onChange={(e) => {
                setMemoryWriteApproval(e.target.checked);
                void saveScalar(
                  "memory.write_approval",
                  e.target.checked ? "true" : "false",
                  t("settings.security.savedWriteApproval"),
                );
              }}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>
        <div className="settings-security-toggle-row">
          <span>{t("settings.security.skillWrites")}</span>
          <label className="tools-toggle">
            <input
              type="checkbox"
              checked={skillsWriteApproval}
              disabled={!skillsWriteLoaded}
              onChange={(e) => {
                setSkillsWriteApproval(e.target.checked);
                void saveScalar(
                  "skills.write_approval",
                  e.target.checked ? "true" : "false",
                  t("settings.security.savedWriteApproval"),
                );
              }}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>
      </div>

      {/* ── Working folder ───────────────────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field-label">
          <FolderOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t("settings.security.workingFolder")}
        </label>
        <div className="settings-security-folder-row">
          <TerminalSquare size={14} className="settings-security-folder-icon" />
          <input
            type="text"
            className="settings-security-folder-input"
            value={workDir}
            disabled={!workDirLoaded}
            placeholder={t("settings.security.workingFolderPlaceholder")}
            onChange={(e) => setWorkDir(e.target.value)}
          />
          <button
            type="button"
            className="settings-security-browse"
            disabled={!workDirLoaded}
            onClick={() => void pickWorkDir()}
          >
            {t("settings.security.browse")}
          </button>
          <button
            type="button"
            className="settings-security-save"
            disabled={!workDirLoaded || saving === "cwd"}
            onClick={() =>
              void saveScalar(
                "terminal.cwd",
                workDir.trim(),
                t("settings.security.savedWorkDir"),
              )
            }
          >
            {saving === "cwd"
              ? t("settings.security.saving")
              : t("settings.security.save")}
          </button>
        </div>
        <div className="settings-field-hint">
          {t("settings.security.workingFolderHint")}
        </div>
      </div>
    </div>
  );
}
