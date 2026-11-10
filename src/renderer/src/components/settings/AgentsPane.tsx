import { useCallback, useEffect, useMemo, useState } from "react";
import {
  REASONING_EFFORT_ORDER,
  type ReasoningEffort,
} from "../../screens/Chat/reasoningTiers";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import SettingsHint from "./SettingsHint";

type AgentsTab = "subagents" | "moa";

interface NumberField {
  key: string;
  label: string;
  hint?: string;
  min: number;
  fallback: string;
}

/** Delegation knobs from the agent's `delegation.*` config section. */
const NUMBER_FIELDS: readonly NumberField[] = [
  {
    key: "delegation.max_iterations",
    label: "Iterations per subagent",
    hint: "Each child gets its own budget, independent of the parent turn.",
    min: 1,
    fallback: "250",
  },
  {
    key: "delegation.max_concurrent_children",
    label: "Parallel subagents",
    hint: "How many children may run at once. Extra tasks queue behind this cap.",
    min: 1,
    fallback: "10",
  },
  {
    key: "delegation.child_timeout_seconds",
    label: "Child inactivity timeout (s)",
    hint: "Time with no progress before a child is stopped. 0 disables the cap.",
    min: 0,
    fallback: "0",
  },
  {
    key: "delegation.max_spawn_depth",
    label: "Maximum spawn depth",
    hint: "1 means subagents cannot delegate further. Each level multiplies cost.",
    min: 1,
    fallback: "1",
  },
  {
    key: "delegation.oneshot_max_children",
    label: "One-shot run limit",
    hint: "Total subagents a finite one-shot run may spawn. 0 is unlimited.",
    min: 0,
    fallback: "2",
  },
];

/** Empty means "inherit the main agent's model/provider". */
const INHERIT = "";

export default function AgentsPane(): React.JSX.Element {
  const { t } = useI18n();
  const { profile, connMode } = useSettings();
  const [tab, setTab] = useState<AgentsTab>("subagents");
  const copy = (key: string, fallback: string): string =>
    t(`settings.agents.${key}`, { defaultValue: fallback });

  return (
    <div
      className="settings-modal-pane"
      key={`${profile ?? ""}:${connMode}`}
    >
      <div
        className="settings-seg settings-agent-tabs"
        role="tablist"
        aria-label={copy("title", "Agents")}
      >
        {(["subagents", "moa"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`agents-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="agents-panel"
            className={`settings-seg-btn${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {id === "subagents"
              ? copy("tabs.subagents", "Subagents")
              : copy("tabs.moa", "Mixture of Agents")}
          </button>
        ))}
      </div>

      <div className="settings-group" role="tabpanel" id="agents-panel">
        {tab === "subagents" ? (
          <SubagentsPanel profile={profile} connMode={connMode} />
        ) : (
          <MoaPanel profile={profile} />
        )}
      </div>
    </div>
  );
}

function SubagentsPanel({
  profile,
  connMode,
}: {
  profile?: string;
  connMode: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const copy = (key: string, fallback: string): string =>
    t(`settings.agents.${key}`, { defaultValue: fallback });
  const [local, setLocal] = useState<boolean | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI
      .getConnectionConfig()
      .then((config) => {
        if (!cancelled) setLocal(config.mode === "local" && connMode === "local");
      })
      .catch(() => {
        if (!cancelled) setLocal(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connMode]);

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    setLoaded(false);
    setError("");
    void Promise.all([
      window.hermesAPI.getConfig("delegation.provider", profile),
      window.hermesAPI.getConfig("delegation.model", profile),
      window.hermesAPI.getConfig("delegation.reasoning_effort", profile),
      ...NUMBER_FIELDS.map((field) => window.hermesAPI.getConfig(field.key, profile)),
    ])
      .then(([provider, model, effort, ...numbers]) => {
        if (cancelled) return;
        const next: Record<string, string> = {
          "delegation.provider": provider ?? INHERIT,
          "delegation.model": model ?? INHERIT,
          "delegation.reasoning_effort": effort ?? INHERIT,
        };
        NUMBER_FIELDS.forEach((field, index) => {
          next[field.key] = numbers[index] ?? field.fallback;
        });
        setValues(next);
        setSaved(next);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy("loadError", "Could not load the subagent settings."));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, profile, retry]);

  async function save(key: string): Promise<void> {
    if (!loaded || saving) return;
    const raw = values[key] ?? "";
    setSaving(key);
    setError("");
    setStatus("");
    try {
      const numeric = NUMBER_FIELDS.some((field) => field.key === key);
      if (numeric) {
        const field = NUMBER_FIELDS.find((entry) => entry.key === key)!;
        const parsed = Number(raw);
        if (!raw.trim() || !Number.isInteger(parsed) || parsed < field.min) {
          throw new Error("invalid");
        }
      }
      const ok = await window.hermesAPI.setConfig(key, raw, profile);
      if (!ok) throw new Error("rejected");
      const readBack = await window.hermesAPI.getConfig(key, profile);
      const normalized = readBack ?? INHERIT;
      if (normalized !== raw) throw new Error("mismatch");
      setSaved((prev) => ({ ...prev, [key]: normalized }));
      setStatus(copy("saved", "Saved. New subagents use this setting."));
    } catch {
      setError(
        copy(
          "saveError",
          "Could not save this subagent setting. Check the value and reload before retrying.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  if (local === null) {
    return <LoadingRow label={copy("loading", "Loading settings…")} />;
  }
  if (!local) {
    return (
      <NoteRow
        text={copy(
          "localOnly",
          "Subagent settings are available for local connections only.",
        )}
      />
    );
  }

  return (
    <>
      {error && <NoteRow text={error} alert />}
      {status && <NoteRow text={status} />}
      {!loaded && !error && <LoadingRow label={copy("loading", "Loading settings…")} />}

      {loaded && (
        <>
          <ConfigRow
            id="agents-subagent-provider"
            label={copy("provider", "Subagent provider")}
            hint={copy(
              "providerHint",
              "Leave blank to let every subagent inherit the main model's provider.",
            )}
            value={values["delegation.provider"] ?? ""}
            placeholder={copy("inherit", "Inherit from main model")}
            disabled={saving !== null}
            dirty={(values["delegation.provider"] ?? "") !== saved["delegation.provider"]}
            saving={saving === "delegation.provider"}
            onChange={(value) =>
              setValues((prev) => ({ ...prev, "delegation.provider": value }))
            }
            onSave={() => void save("delegation.provider")}
          />
          <ConfigRow
            id="agents-subagent-model"
            label={copy("model", "Subagent model")}
            hint={copy(
              "modelHint",
              "Blank inherits the main model. Pinning a model without a provider uses the main provider's credentials.",
            )}
            value={values["delegation.model"] ?? ""}
            placeholder={copy("inherit", "Inherit from main model")}
            disabled={saving !== null}
            dirty={(values["delegation.model"] ?? "") !== saved["delegation.model"]}
            saving={saving === "delegation.model"}
            onChange={(value) =>
              setValues((prev) => ({ ...prev, "delegation.model": value }))
            }
            onSave={() => void save("delegation.model")}
          />
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="agents-subagent-effort">
                {copy("effort", "Subagent thinking level")}
              </label>
              <SettingsHint>
                {copy(
                  "effortHint",
                  "Overrides the main model's reasoning effort for delegated work. Blank inherits it.",
                )}
              </SettingsHint>
            </div>
            <div className="settings-agent-control">
              <select
                id="agents-subagent-effort"
                className="settings-security-folder-input settings-agent-input"
                disabled={saving !== null}
                value={values["delegation.reasoning_effort"] ?? ""}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    "delegation.reasoning_effort": event.target.value,
                  }))
                }
              >
                <option value="">{copy("inherit", "Inherit from main model")}</option>
                {REASONING_EFFORT_ORDER.filter(
                  (tier): tier is Exclude<ReasoningEffort, "auto"> => tier !== "auto",
                ).map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={
                  saving !== null ||
                  (values["delegation.reasoning_effort"] ?? "") ===
                    saved["delegation.reasoning_effort"]
                }
                onClick={() => void save("delegation.reasoning_effort")}
              >
                {saving === "delegation.reasoning_effort"
                  ? copy("saving", "Saving…")
                  : copy("save", "Save")}
              </button>
            </div>
          </div>

          {NUMBER_FIELDS.map((field) => (
            <ConfigRow
              key={field.key}
              id={`agents-${field.key.replaceAll(".", "-")}`}
              label={copy(`fields.${field.key.replaceAll(".", "_")}`, field.label)}
              hint={field.hint}
              numeric
              min={field.min}
              value={values[field.key] ?? ""}
              disabled={saving !== null}
              dirty={(values[field.key] ?? "") !== saved[field.key]}
              saving={saving === field.key}
              onChange={(value) =>
                setValues((prev) => ({ ...prev, [field.key]: value }))
              }
              onSave={() => void save(field.key)}
            />
          ))}

          <NoteRow
            text={copy(
              "reloadHint",
              "Changes apply to new subagent runs; a running turn keeps the settings it started with.",
            )}
          />
          <div className="settings-agent-toolbar">
            <span className="settings-field-hint">
              {copy(
                "scope",
                "Applies to the selected Hermes profile. Advanced routing backends (model maps, profile routes) stay in the official desktop.",
              )}
            </span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={saving !== null}
              onClick={() => setRetry((value) => value + 1)}
            >
              {copy("reload", "Reload settings")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

interface MoaDraft {
  defaultPreset: string;
  activePreset: string;
  presets: Record<
    string,
    {
      enabled: boolean;
      referenceModels: Array<{ provider: string; model: string }>;
      aggregator: { provider: string; model: string };
      referenceTemperature: string;
      aggregatorTemperature: string;
      referenceTimeout: string;
      degradedPolicy: "loud" | "silent";
    }
  >;
}

function MoaPanel({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const copy = (key: string, fallback: string): string =>
    t(`settings.agents.${key}`, { defaultValue: fallback });
  const [draft, setDraft] = useState<MoaDraft | null>(null);
  const [preset, setPreset] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const config = await window.hermesAPI.getMoaConfig(profile);
      const presets: MoaDraft["presets"] = {};
      for (const [name, value] of Object.entries(config.presets)) {
        presets[name] = {
          enabled: value.enabled,
          referenceModels: value.reference_models.map((slot) => ({
            provider: slot.provider,
            model: slot.model,
          })),
          aggregator: {
            provider: value.aggregator.provider,
            model: value.aggregator.model,
          },
          referenceTemperature:
            value.reference_temperature === null ? "" : String(value.reference_temperature),
          aggregatorTemperature:
            value.aggregator_temperature === null ? "" : String(value.aggregator_temperature),
          referenceTimeout:
            value.reference_timeout === null ? "" : String(value.reference_timeout),
          degradedPolicy: value.degraded_reference_policy,
        };
      }
      setDraft({
        defaultPreset: config.default_preset,
        activePreset: config.active_preset,
        presets,
      });
      setPreset((current) =>
        current && presets[current]
          ? current
          : config.active_preset && presets[config.active_preset]
            ? config.active_preset
            : config.default_preset in presets
              ? config.default_preset
              : Object.keys(presets)[0] ?? "",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : copy("moaLoadError", "Could not load the Mixture of Agents configuration."),
      );
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = draft && preset ? draft.presets[preset] : undefined;
  const complete = useMemo(() => {
    if (!current) return false;
    const filled = (slot: { provider: string; model: string }): boolean =>
      Boolean(slot.provider.trim() && slot.model.trim());
    return (
      current.referenceModels.length > 0 &&
      current.referenceModels.every(filled) &&
      filled(current.aggregator)
    );
  }, [current]);

  function updatePreset(patch: Partial<NonNullable<typeof current>>): void {
    if (!draft || !preset || !current) return;
    setDraft({
      ...draft,
      presets: { ...draft.presets, [preset]: { ...current, ...patch } },
    });
  }

  async function save(): Promise<void> {
    if (!draft || !complete) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const numberOrNull = (value: string): number | null => {
        const n = Number(value);
        return value.trim() && Number.isFinite(n) ? n : null;
      };
      const payload = {
        default_preset: draft.defaultPreset,
        active_preset: draft.activePreset,
        presets: Object.fromEntries(
          Object.entries(draft.presets).map(([name, entry]) => [
            name,
            {
              reference_models: entry.referenceModels.map((slot) => ({
                provider: slot.provider.trim(),
                model: slot.model.trim(),
              })),
              aggregator: {
                provider: entry.aggregator.provider.trim(),
                model: entry.aggregator.model.trim(),
              },
              reference_temperature: numberOrNull(entry.referenceTemperature),
              aggregator_temperature: numberOrNull(entry.aggregatorTemperature),
              reference_timeout: numberOrNull(entry.referenceTimeout),
              degraded_reference_policy: entry.degradedPolicy,
              enabled: entry.enabled,
            },
          ]),
        ),
      };
      await window.hermesAPI.saveMoaConfig(payload, profile);
      await load();
      setStatus(copy("moaSaved", "Mixture of Agents configuration saved."));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : copy("moaSaveError", "Could not save the Mixture of Agents configuration."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !draft) return <LoadingRow label={copy("loading", "Loading settings…")} />;

  return (
    <>
      {error && <NoteRow text={error} alert />}
      {status && <NoteRow text={status} />}
      {!current ? (
        <NoteRow
          text={copy(
            "moaEmpty",
            "This profile has no Mixture of Agents presets. Create one with the Hermes CLI, then reload.",
          )}
        />
      ) : (
        <>
          <p className="settings-field-hint">
            {copy(
              "moaIntro",
              "Reference models answer first; the aggregator merges their guidance before the main model runs. Presets keep separate model sets you can switch between.",
            )}
          </p>

          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="agents-moa-preset">
                {copy("moaPreset", "Preset")}
              </label>
              <SettingsHint>
                {copy(
                  "moaPresetHint",
                  "The active preset is what /moa uses in a chat; the default applies to new sessions.",
                )}
              </SettingsHint>
            </div>
            <div className="settings-agent-control">
              <select
                id="agents-moa-preset"
                className="settings-security-folder-input settings-agent-input"
                disabled={saving}
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
              >
                {Object.keys(draft?.presets ?? {}).map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {name === draft?.defaultPreset ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="agents-moa-enabled">
                {copy("moaEnabled", "Enable this preset")}
              </label>
              <SettingsHint>
                {copy("moaEnabledHint", "Off keeps the models configured but skips the reference round.")}
              </SettingsHint>
            </div>
            <label className="tools-toggle">
              <input
                id="agents-moa-enabled"
                type="checkbox"
                disabled={saving}
                checked={current.enabled}
                onChange={(event) => updatePreset({ enabled: event.target.checked })}
              />
              <span className="tools-toggle-track" />
            </label>
          </div>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-text">
              <span className="settings-row-label">{copy("moaReference", "Reference models")}</span>
              <SettingsHint>
                {copy("moaReferenceHint", "Tried in order; every slot needs a provider and a model.")}
              </SettingsHint>
            </div>
            <div className="settings-agent-stack">
              {current.referenceModels.map((slot, index) => (
                <div className="settings-agent-slot" key={`ref-${index}`}>
                  <span className="settings-agent-slot-index">{index + 1}</span>
                  <input
                    className="settings-security-folder-input"
                    aria-label={`Reference ${index + 1} provider`}
                    placeholder={copy("provider", "Provider")}
                    value={slot.provider}
                    disabled={saving}
                    onChange={(event) =>
                      updatePreset({
                        referenceModels: current.referenceModels.map((entry, i) =>
                          i === index ? { ...entry, provider: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <input
                    className="settings-security-folder-input"
                    aria-label={`Reference ${index + 1} model`}
                    placeholder={copy("modelId", "Model")}
                    value={slot.model}
                    disabled={saving}
                    onChange={(event) =>
                      updatePreset({
                        referenceModels: current.referenceModels.map((entry, i) =>
                          i === index ? { ...entry, model: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={saving || current.referenceModels.length <= 1}
                    onClick={() =>
                      updatePreset({
                        referenceModels: current.referenceModels.filter((_, i) => i !== index),
                      })
                    }
                  >
                    {copy("remove", "Remove")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-sm settings-agent-add"
                disabled={saving}
                onClick={() =>
                  updatePreset({
                    referenceModels: [...current.referenceModels, { provider: "", model: "" }],
                  })
                }
              >
                {copy("moaAddReference", "Add reference model")}
              </button>
            </div>
          </div>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-text">
              <span className="settings-row-label">{copy("moaAggregator", "Aggregator")}</span>
              <SettingsHint>
                {copy("moaAggregatorHint", "Synthesizes the reference answers into one guidance block.")}
              </SettingsHint>
            </div>
            <div className="settings-agent-stack">
              <div className="settings-agent-slot">
                <span className="settings-agent-slot-index">1</span>
                <input
                  className="settings-security-folder-input"
                  aria-label="Aggregator provider"
                  placeholder={copy("provider", "Provider")}
                  value={current.aggregator.provider}
                  disabled={saving}
                  onChange={(event) =>
                    updatePreset({
                      aggregator: { ...current.aggregator, provider: event.target.value },
                    })
                  }
                />
                <input
                  className="settings-security-folder-input"
                  aria-label="Aggregator model"
                  placeholder={copy("modelId", "Model")}
                  value={current.aggregator.model}
                  disabled={saving}
                  onChange={(event) =>
                    updatePreset({
                      aggregator: { ...current.aggregator, model: event.target.value },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <ConfigRow
            id="agents-moa-reference-temp"
            label={copy("moaReferenceTemp", "Reference temperature")}
            hint={copy("temperatureHint", "Blank uses the provider default.")}
            value={current.referenceTemperature}
            disabled={saving}
            dirty={false}
            saving={false}
            onChange={(value) => updatePreset({ referenceTemperature: value })}
            onSave={() => undefined}
            hideSave
          />
          <ConfigRow
            id="agents-moa-aggregator-temp"
            label={copy("moaAggregatorTemp", "Aggregator temperature")}
            hint={copy("temperatureHint", "Blank uses the provider default.")}
            value={current.aggregatorTemperature}
            disabled={saving}
            dirty={false}
            saving={false}
            onChange={(value) => updatePreset({ aggregatorTemperature: value })}
            onSave={() => undefined}
            hideSave
          />
          <ConfigRow
            id="agents-moa-timeout"
            label={copy("moaTimeout", "Reference timeout (s)")}
            hint={copy("moaTimeoutHint", "Blank inherits the auxiliary MoA reference timeout.")}
            value={current.referenceTimeout}
            disabled={saving}
            dirty={false}
            saving={false}
            onChange={(value) => updatePreset({ referenceTimeout: value })}
            onSave={() => undefined}
            hideSave
          />

          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="agents-moa-degraded">
                {copy("moaDegraded", "When a reference fails")}
              </label>
              <SettingsHint>
                {copy("moaDegradedHint", "Loud surfaces the failure; silent continues with the rest.")}
              </SettingsHint>
            </div>
            <div className="settings-agent-control">
              <select
                id="agents-moa-degraded"
                className="settings-security-folder-input settings-agent-input"
                disabled={saving}
                value={current.degradedPolicy}
                onChange={(event) =>
                  updatePreset({ degradedPolicy: event.target.value === "silent" ? "silent" : "loud" })
                }
              >
                <option value="loud">Loud</option>
                <option value="silent">Silent</option>
              </select>
            </div>
          </div>

          {!complete && (
            <NoteRow
              text={copy(
                "moaIncomplete",
                "Fill every reference slot and the aggregator before saving; the backend rejects incomplete presets.",
              )}
            />
          )}

          <div className="settings-agent-toolbar">
            <span className="settings-field-hint">
              {copy(
                "moaScope",
                "Saved through the dashboard's /api/model/moa endpoint, the same document /moa and the CLI read.",
              )}
            </span>
            <div className="settings-agent-control">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={saving}
                onClick={() => void load()}
              >
                {copy("reload", "Reload settings")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={saving || !complete}
                onClick={() => void save()}
              >
                {saving ? copy("saving", "Saving…") : copy("save", "Save")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function LoadingRow({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span role="status" className="settings-row-hint">{label}</span>
      </div>
    </div>
  );
}

function NoteRow({ text, alert }: { text: string; alert?: boolean }): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div role={alert ? "alert" : "status"} className="settings-row-hint">
          {text}
        </div>
      </div>
    </div>
  );
}

function ConfigRow({
  id,
  label,
  hint,
  value,
  placeholder,
  numeric,
  min,
  disabled,
  dirty,
  saving,
  onChange,
  onSave,
  hideSave,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  numeric?: boolean;
  min?: number;
  disabled?: boolean;
  dirty: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  hideSave?: boolean;
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <label className="settings-row-label" htmlFor={id}>{label}</label>
        {hint && <SettingsHint>{hint}</SettingsHint>}
      </div>
      <div className="settings-agent-control">
        <input
          id={id}
          className="settings-security-folder-input settings-agent-input"
          type={numeric ? "number" : "text"}
          min={min}
          step={1}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {!hideSave && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Save ${label}`}
            disabled={disabled || !dirty}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}
