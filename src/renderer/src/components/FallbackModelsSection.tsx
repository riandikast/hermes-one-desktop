import { useCallback, useEffect, useMemo, useState } from "react";
import { notifyFallbackConfigChanged } from "../screens/Chat/fallbackModels";
import SettingsHint from "./settings/SettingsHint";
import { useI18n } from "./useI18n";

interface PickerProviderOption {
  key: string;
  brand: string;
  label: string;
  provider: string;
  baseUrl: string;
  models: Array<{ model: string; name?: string }>;
}

interface FallbackRow {
  provider: string;
  model: string;
  /** Any other keys the entry carried (`base_url`, `key_env`, `api_mode`, …). */
  extra: Record<string, string>;
}

const EMPTY_ROW: FallbackRow = { provider: "", model: "", extra: {} };

/**
 * Fallback Models — the official desktop's Model › Fallbacks subpage, placed on
 * the Providers page under the default model.
 *
 * The chain is the top-level `fallback_providers` list the agent tries, in
 * order, when the main model fails. Rows are edited here and written as real
 * YAML mappings; keys this editor does not expose (`base_url`, `key_env`,
 * `api_mode`, …) ride along so a local-gateway chain is never rewritten into a
 * bare provider/model pair and re-routed to a public endpoint.
 */
export default function FallbackModelsSection({
  profile,
  providers,
}: {
  profile?: string;
  providers: PickerProviderOption[];
}): React.JSX.Element {
  const { t } = useI18n();
  const copy = (key: string, fallback: string): string =>
    t(`providers.fallbackModels.${key}`, { defaultValue: fallback });
  const [rows, setRows] = useState<FallbackRow[]>([]);
  const [savedRows, setSavedRows] = useState<FallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const read = window.hermesAPI.getFallbackProviders;
      if (typeof read !== "function") {
        setLoading(false);
        return;
      }
      const entries = await read.call(window.hermesAPI, profile);
      const next = entries.map((entry) => {
        const { provider = "", model = "", ...extra } = entry;
        return { provider, model, extra };
      });
      setRows(next);
      setSavedRows(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : copy("loadError", "Could not read the fallback chain."),
      );
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const providerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of providers) {
      if (!row.provider) continue;
      if (!seen.has(row.provider)) seen.set(row.provider, row.label);
    }
    for (const row of rows) {
      if (row.provider && !seen.has(row.provider)) seen.set(row.provider, row.provider);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [providers, rows]);

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(savedRows),
    [rows, savedRows],
  );

  const complete = rows.filter((row) => row.provider.trim() && row.model.trim());

  function updateRow(index: number, patch: Partial<FallbackRow>): void {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function moveRow(index: number, direction: -1 | 1): void {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry!);
      return next;
    });
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const entries = complete.map((row) => ({
        ...row.extra,
        provider: row.provider.trim(),
        model: row.model.trim(),
      }));
      const ok = await window.hermesAPI.setConfig(
        "fallback_providers",
        JSON.stringify(entries),
        profile,
      );
      if (!ok) throw new Error("rejected");
      // Read back through the configured source of truth: a write the backend
      // would drop (object list rendered as quoted scalars) must not look saved.
      const stored = await window.hermesAPI.getFallbackProviders(profile);
      const readBack = stored.map((entry) => `${entry.provider}/${entry.model}`);
      const expected = entries.map((entry) => `${entry.provider}/${entry.model}`);
      if (JSON.stringify(readBack) !== JSON.stringify(expected)) {
        throw new Error("mismatch");
      }
      await load();
      // The chat model picker caches this chain; tell it the file changed.
      notifyFallbackConfigChanged();
      setStatus(
        copy(
          "saved",
          "Saved. Failed turns now try this chain in order; existing chats pick it up on their next turn.",
        ),
      );
    } catch {
      setError(
        copy(
          "saveError",
          "Could not save and verify the fallback chain. Reload before retrying; the file may have been partially written.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const modelsFor = (provider: string): string[] => {
    const match = providers.find((entry) => entry.provider === provider);
    return match ? [...new Set(match.models.map((model) => model.model))] : [];
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title settings-section-title-row">
        <span>{copy("title", "Fallback Models")}</span>
        <SettingsHint>
          {copy("intro", "Tried in order when the default model fails (provider outage, missing model, auth rejection). Leave the list empty to fail the turn instead of switching models.")}
        </SettingsHint>
        {status && (
          <span className="settings-saved" role="status">
            {status}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="settings-field-hint" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {loading ? (
        <p role="status" className="settings-field-hint">
          {copy("loading", "Loading the fallback chain…")}
        </p>
      ) : (
        <div className="fallback-models">
          {rows.length === 0 && (
            <p className="settings-field-hint">{copy("empty", "No fallback models configured.")}</p>
          )}
          {rows.map((row, index) => (
            <div className="fallback-model-row" key={`fallback-${index}`}>
              <span className="fallback-model-index">{index + 1}</span>
              <select
                className="input fallback-model-provider"
                aria-label={`Fallback ${index + 1} provider`}
                value={row.provider}
                disabled={saving}
                onChange={(event) => updateRow(index, { provider: event.target.value })}
              >
                <option value="">{copy("providerPlaceholder", "Provider")}</option>
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="input fallback-model-id"
                aria-label={`Fallback ${index + 1} model`}
                placeholder={copy("modelPlaceholder", "Model")}
                list={`fallback-models-${index}`}
                value={row.model}
                disabled={saving}
                onChange={(event) => updateRow(index, { model: event.target.value })}
              />
              <datalist id={`fallback-models-${index}`}>
                {modelsFor(row.provider).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <div className="fallback-model-actions">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={`Move fallback ${index + 1} up`}
                  disabled={saving || index === 0}
                  onClick={() => moveRow(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={`Move fallback ${index + 1} down`}
                  disabled={saving || index === rows.length - 1}
                  onClick={() => moveRow(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={`Remove fallback ${index + 1}`}
                  disabled={saving}
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  {copy("remove", "Remove")}
                </button>
              </div>
            </div>
          ))}

          <div className="fallback-model-footer">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW, extra: {} }])}
            >
              {copy("add", "Add fallback model")}
            </button>
            <div className="fallback-model-actions">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={saving || !dirty}
                onClick={() => setRows(savedRows)}
              >
                {copy("reset", "Reset")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saving || !dirty || complete.length !== rows.length}
                onClick={() => void save()}
              >
                {saving ? copy("saving", "Saving…") : copy("save", "Save chain")}
              </button>
            </div>
          </div>
          {complete.length !== rows.length && (
            <p className="settings-field-hint">
              {copy(
                "incomplete",
                "Every row needs a provider and a model before the chain can be saved.",
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
