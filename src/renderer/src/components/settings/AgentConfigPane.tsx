import { useEffect, useRef, useState } from "react";
import { ADVANCED_SETTINGS, MEMORY_SETTINGS, agentSettingsScalar, type AgentSettingsField } from "../../../../shared/agent-settings";
import { useI18n } from "../useI18n";
import { appConfirm } from "../modal/appConfirm";
import { useSettings } from "./SettingsDataContext";
import { bindingsFor } from "../../../../shared/keyboard-shortcuts";
import { loadKeyboardShortcuts, saveKeyboardShortcuts, shortcutPlatform, useKeyboardShortcuts } from "../../utils/keyboardShortcuts";

const GROUPS: Record<string, string> = {
  persistent: "Persistent memory", context: "Context & compression", desktop: "Desktop updates",
  runtime: "Runtime", tools: "Tools", terminal: "Terminal", output: "Output & checkpoints",
};

/** Backend settings stay profile-scoped; remount drafts rather than crossing profile/connection boundaries. */
export default function AgentConfigPane({ section }: { section: "advanced" | "memory" }): React.JSX.Element {
  const { profile, connMode } = useSettings();
  return <AgentConfigFields key={`${section}:${profile ?? ""}:${connMode}`} section={section} profile={profile} mode={connMode} />;
}

function displayValue(field: AgentSettingsField, raw: string | null): string {
  if (raw === null || raw === "null" || raw === "None" || raw === "~") raw = field.defaultValue;
  if (field.type === "boolean") return String(["true", "1", "yes", "on"].includes(raw.toLowerCase()));
  if (field.key === "agent.max_turns" && ["0", "-1", "none", "unlimited", "inf"].includes(raw.toLowerCase())) return "";
  if (field.type === "number" && raw !== "" && Number.isFinite(Number(raw))) return String(Number(raw));
  if (field.type === "list") {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("Invalid toolsets configuration.");
    return parsed.join(", ");
  }
  return raw;
}

function AgentConfigFields({ section, profile, mode }: {
  section: "advanced" | "memory"; profile?: string; mode: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const fields = section === "memory" ? MEMORY_SETTINGS : ADVANCED_SETTINGS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<string[]>([]);
  const [providerError, setProviderError] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const [connectionMode, setConnectionMode] = useState<string | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const local = connectionMode === "local" && mode === "local";
  const copy = (key: string, fallback: string): string => t(`settings.agentConfig.${key}`, { defaultValue: fallback });

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI.getConnectionConfig().then((config) => {
      if (!cancelled) setConnectionMode(config.mode);
    }).catch(() => { if (!cancelled) setConnectionMode("unavailable"); });
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    if (!local) return () => { alive.current = false; };
    setLoaded(false);
    setError("");
    void Promise.all(fields.map(async (field) => [field.key, displayValue(field, await window.hermesAPI.getConfig(field.key, profile))] as const))
      .then((entries) => {
        if (cancelled) return;
        const next = Object.fromEntries(entries);
        setValues(next);
        setSaved(next);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setError(copy("loadError", "Could not load settings. Nothing has been changed.")); });
    if (section === "memory") {
      setProviderError(false);
      void window.hermesAPI.discoverMemoryProviders(profile)
        .then((list) => { if (!cancelled) setProviders([...new Set(list.map((provider) => provider.name))]); })
        .catch(() => { if (!cancelled) setProviderError(true); });
    }
    return () => { cancelled = true; alive.current = false; };
    // The keyed parent owns profile/connection changes; retries reload authoritative values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, local, profile, retry, section]);

  async function save(field: AgentSettingsField): Promise<void> {
    if (busy.current || !local || !loaded) return;
    busy.current = true;
    setSaving(field.key);
    setError("");
    setStatus("");
    try {
      const draft = values[field.key];
      const value = field.type === "list" ? JSON.stringify(draft.split(",").map((name) => name.trim()).filter(Boolean)) : field.nullable && draft === "" ? "null" : draft;
      agentSettingsScalar(field.key, value);
      if (field.key === "toolsets" && value === "[]" && saved[field.key] !== "" &&
        !await appConfirm(copy("clearToolsets", "Disable all toolsets? Memory, terminal, web search, delegation and most tools will be unavailable in new sessions."))) return;
      if (field.key === "updates.non_interactive_local_changes" && value === "discard" &&
        !await appConfirm(copy("discardUpdates", "Allow non-interactive backend updates to permanently discard local source edits? Choose Stash to preserve them."))) return;
      if (!alive.current) return;
      if ((await window.hermesAPI.getConnectionConfig()).mode !== "local") throw new Error("Connection changed");
      const ok = await window.hermesAPI.setConfig(field.key, value, profile);
      if (!ok) throw new Error("Write rejected");
      const readBack = await window.hermesAPI.getConfig(field.key, profile);
      const normalized = displayValue(field, readBack);
      const expected = displayValue(field, value);
      if (readBack === null || normalized !== expected) throw new Error("Settings read-back mismatch");
      if (!alive.current) return;
      setSaved((prev) => ({ ...prev, [field.key]: normalized }));
      setValues((prev) => ({ ...prev, [field.key]: normalized }));
      setStatus(copy("saved", "Saved and verified. Start a new session to use changed agent settings; existing sessions are not restarted."));
    } catch {
      if (alive.current) setError(copy("saveError", "Could not save and verify this setting. Check the value, then reload before retrying; a write may have partially applied."));
    } finally {
      busy.current = false;
      if (alive.current) setSaving(null);
    }
  }

  return <div className="settings-modal-pane">
    <h2 className="settings-field-label">{copy(section, section === "memory" ? "Memory & Context" : "Advanced")}</h2>
    {section === "advanced" && <DesktopSettings />}
    <p className="settings-field-hint">{copy("scope", "Applies to the selected Hermes profile. Each Save writes only that setting. Agent changes apply to new sessions, not the current conversation.")}</p>
    {connectionMode === null ? <p role="status">{copy("loading", "Loading settings…")}</p> : !local ? <p role="status" className="settings-field-hint">{copy("localOnly", "These settings are available for local connections only. The existing remote/SSH config bridge cannot safely write native typed values; no local configuration will be changed for a remote agent.")}</p> : <>
      {error && <div role="alert" className="settings-field-hint">{error}</div>}
      {status && <div role="status" className="settings-pane-flash">{status}</div>}
      <button type="button" className="settings-security-save" disabled={saving !== null} onClick={() => setRetry((n) => n + 1)}>{copy("reload", "Reload settings")}</button>
      {!loaded && !error && <p role="status">{copy("loading", "Loading settings…")}</p>}
      {providerError && <p role="alert" className="settings-field-hint">{copy("providerError", "Provider discovery failed. The saved provider is retained. Reload to retry discovery.")}</p>}
      {section === "memory" && loaded && <p role="status" className="settings-field-hint">{copy("memoryLayers", "MEMORY.md and USER.md injection is controlled independently below. The external provider selection is saved configuration, not proof of readiness. Provider installation, credentials and advanced setup remain on the Memory page / official desktop.")}</p>}
      {Object.entries(GROUPS).filter(([group]) => fields.some((field) => field.group === group)).map(([group, title]) => <section key={group} aria-labelledby={`agent-settings-${group}`}>
        <h3 id={`agent-settings-${group}`} className="settings-field-label">{copy(`groups.${group}`, title)}</h3>
        {fields.filter((field) => field.group === group).map((field) => {
          const id = `agent-setting-${field.key}`;
          const label = copy(`fields.${field.key.replaceAll(".", "_")}`, field.label);
          const value = values[field.key] ?? "";
          const options = field.key === "memory.provider" ? [...new Set(["", ...providers, value])] : [...new Set([...(field.options ?? []), value])];
          return <div className="settings-field" key={field.key}>
            <label className="settings-field-label" htmlFor={id}>{label}</label>
            <div className="settings-security-folder-row">
              {field.type === "boolean" ? <label className="tools-toggle">
                <input id={id} type="checkbox" aria-describedby={`${id}-hint`} disabled={!loaded || saving !== null} checked={value === "true"} onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: String(e.target.checked) }))} />
                <span className="tools-toggle-track" />
              </label> : field.type === "select" ? <select id={id} className="settings-security-folder-input" aria-describedby={`${id}-hint`} disabled={!loaded || saving !== null || (field.key === "memory.provider" && providerError)} value={value} onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}>
                {options.map((option) => <option key={option} value={option}>{option || copy(field.key === "memory.provider" ? "builtin" : "default", field.key === "memory.provider" ? "Built-in memory only" : "Default")}</option>)}
              </select> : <input id={id} className="settings-security-folder-input" aria-describedby={`${id}-hint`} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.step ?? 1} placeholder={field.nullable ? copy("optional", "Optional") : undefined} disabled={!loaded || saving !== null} value={value} onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))} />}
              <button type="button" className="settings-security-save" aria-label={`${copy("save", "Save")} ${label}`} disabled={!loaded || saving !== null || value === saved[field.key]} onClick={() => void save(field)}>{saving === field.key ? copy("saving", "Saving…") : copy("save", "Save")}</button>
            </div>
            <div id={`${id}-hint`} className="settings-field-hint"><code>{field.key}</code>{field.hint && <> — {copy(`hints.${field.key.replaceAll(".", "_")}`, field.hint)}</>}</div>
          </div>;
        })}
      </section>)}
    </>}
  </div>;
}

/** Reuse the shortcut API: removing F12 retains other DevTools chords. */
function DesktopSettings(): React.JSX.Element {
  const { t } = useI18n();
  const shortcuts = useKeyboardShortcuts();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bindings = bindingsFor("devTools", shortcuts, shortcutPlatform());
  const disabled = !bindings.includes("F12");
  useEffect(() => {
    let cancelled = false;
    void loadKeyboardShortcuts().then(() => { if (!cancelled) setReady(true); }).catch(() => {
      if (!cancelled) setError(t("settings.agentConfig.shortcutError", { defaultValue: "Could not read or save desktop shortcuts." }));
    });
    return () => { cancelled = true; };
  }, [t]);
  return <div className="settings-field">
    <label className="settings-field-label" htmlFor="advanced-disable-f12">{t("settings.agentConfig.disableF12", { defaultValue: "Disable F12 Developer Tools" })}</label>
    <label className="tools-toggle">
      <input id="advanced-disable-f12" type="checkbox" checked={disabled} disabled={!ready || busy} onChange={async (event) => {
        const next = event.target.checked ? bindings.filter((binding) => binding !== "F12") : [...bindings, "F12"];
        setBusy(true);
        setError("");
        try { await saveKeyboardShortcuts({ ...shortcuts, devTools: next }); }
        catch { setError(t("settings.agentConfig.shortcutError", { defaultValue: "Could not read or save desktop shortcuts." })); }
        finally { setBusy(false); }
      }} />
      <span className="tools-toggle-track" />
    </label>
    <p className="settings-field-hint">{t("settings.agentConfig.disableF12Hint", { defaultValue: "This computer only. Other Developer Tools shortcuts remain unchanged. Links already open in the system browser in Hermes One." })}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
