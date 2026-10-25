import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  X,
  VisionIcon,
  CompressionIcon,
  TitleIcon,
  TriageIcon,
  ApprovalIcon,
  CuratorIcon,
  ProfileIcon,
  Globe,
  Layers,
  Puzzle,
  Kanban,
  Pencil,
} from "../assets/icons";
import { LOCAL_PRESETS, PROVIDERS } from "../constants";
import { useI18n } from "./useI18n";
import { useDiscoveredModels } from "../hooks/useDiscoveredModels";

function localPresetForProvider(value: string): {
  id: string;
  baseUrl: string;
} | null {
  return (
    LOCAL_PRESETS.find((p) => p.group === "local" && p.id === value) || null
  );
}

// Per-task model overrides for the agent's auxiliary tasks (vision, compression,
// title generation, …). Reads/writes the `auxiliary.*` blocks in config.yaml via
// its own IPC — independent of the model library. Relocated out of the removed
// Models screen onto the Providers tab.
function AuxiliaryTasksSection({
  visible,
}: {
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  const [auxConfig, setAuxConfig] = useState<
    { task: string; provider: string; model: string; baseUrl: string }[]
  >([]);
  const [showAuxModal, setShowAuxModal] = useState(false);
  const [auxEditingTask, setAuxEditingTask] = useState<string | null>(null);
  const [auxFormProvider, setAuxFormProvider] = useState("auto");
  const [auxFormModel, setAuxFormModel] = useState("");
  const [auxFormBaseUrl, setAuxFormBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAuxModal) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLElement>("select")?.focus();
    return () => previous?.focus();
  }, [showAuxModal]);

  const auxDiscoveryBaseUrl =
    auxFormProvider === "custom" || localPresetForProvider(auxFormProvider)
      ? auxFormBaseUrl
      : undefined;
  const [auxDiscoveryRefresh, setAuxDiscoveryRefresh] = useState(0);
  const auxDiscovery = useDiscoveredModels({
    provider: auxFormProvider,
    baseUrl: auxDiscoveryBaseUrl,
    enabled: showAuxModal && auxFormProvider !== "auto",
    refreshToken: auxDiscoveryRefresh,
  });

  const loadAuxConfig = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setAuxConfig(await window.hermesAPI.getAuxiliaryConfig());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuxConfig();
  }, [loadAuxConfig]);

  // Reload whenever the pane becomes visible — the component is mounted once
  // and kept alive alongside the Providers tab.
  useEffect(() => {
    if (visible) void loadAuxConfig();
  }, [visible, loadAuxConfig]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      void loadAuxConfig();
    });
  }, [loadAuxConfig]);

  const auxTaskLabels: Record<
    string,
    { name: string; hint: string; icon: React.ComponentType<{ size?: number }> }
  > = {
    vision: {
      name: "constants.auxiliaryVision",
      hint: "constants.auxiliaryVisionHint",
      icon: VisionIcon,
    },
    web_extract: {
      name: "constants.auxiliaryWebExtract",
      hint: "constants.auxiliaryWebExtractHint",
      icon: Globe,
    },
    compression: {
      name: "constants.auxiliaryCompression",
      hint: "constants.auxiliaryCompressionHint",
      icon: CompressionIcon,
    },
    skills_hub: {
      name: "constants.auxiliarySkillsHub",
      hint: "constants.auxiliarySkillsHubHint",
      icon: Puzzle,
    },
    approval: {
      name: "constants.auxiliaryApproval",
      hint: "constants.auxiliaryApprovalHint",
      icon: ApprovalIcon,
    },
    mcp: {
      name: "constants.auxiliaryMcp",
      hint: "constants.auxiliaryMcpHint",
      icon: Layers,
    },
    title_generation: {
      name: "constants.auxiliaryTitleGeneration",
      hint: "constants.auxiliaryTitleGenerationHint",
      icon: TitleIcon,
    },
    triage_specifier: {
      name: "constants.auxiliaryTriageSpecifier",
      hint: "constants.auxiliaryTriageSpecifierHint",
      icon: TriageIcon,
    },
    kanban_decomposer: {
      name: "constants.auxiliaryKanbanDecomposer",
      hint: "constants.auxiliaryKanbanDecomposerHint",
      icon: Kanban,
    },
    profile_describer: {
      name: "constants.auxiliaryProfileDescriber",
      hint: "constants.auxiliaryProfileDescriberHint",
      icon: ProfileIcon,
    },
    curator: {
      name: "constants.auxiliaryCurator",
      hint: "constants.auxiliaryCuratorHint",
      icon: CuratorIcon,
    },
  };

  function openAuxEdit(task: string): void {
    const current = auxConfig.find((c) => c.task === task);
    setAuxEditingTask(task);
    setAuxFormProvider(current?.provider || "auto");
    setAuxFormModel(current?.model || "");
    setAuxFormBaseUrl(current?.baseUrl || "");
    setShowAuxModal(true);
  }

  function closeAuxModal(): void {
    setShowAuxModal(false);
    setAuxEditingTask(null);
  }

  async function handleAuxSave(): Promise<void> {
    if (!auxEditingTask || saving) return;
    setSaving(true);
    try {
      await window.hermesAPI.setAuxiliaryTask(auxEditingTask, {
        provider: auxFormProvider,
        model: auxFormModel,
        baseUrl: auxFormBaseUrl,
      });
      const updated = await window.hermesAPI.getAuxiliaryConfig();
      setAuxConfig(updated);
      closeAuxModal();
      toast.success(t("constants.auxiliarySaved"));
    } catch {
      toast.error(t("common.errorMessage"));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetAux(): Promise<void> {
    try {
      await window.hermesAPI.resetAuxiliaryConfig();
      const updated = await window.hermesAPI.getAuxiliaryConfig();
      setAuxConfig(updated);
      toast.success(t("constants.auxiliaryResetSuccess"));
    } catch {
      toast.error(t("common.errorMessage"));
    }
  }

  return (
    <>
      <section className="auxiliary-header">
        <div>
          <h2 className="settings-section-title">
            {t("constants.auxiliaryTitle")}
          </h2>
          <p className="settings-field-hint">
            {t("constants.auxiliaryDescription")}
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleResetAux}
          disabled={loading || error || !auxConfig.length}
        >
          {t("constants.auxiliaryResetAll")}
        </button>
      </section>
      {loading && <p role="status">{t("common.loading")}</p>}
      {error && (
        <div role="alert">
          {t("common.errorMessage")}{" "}
          <button
            className="btn btn-secondary"
            onClick={() => void loadAuxConfig()}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      {!loading && !error && !auxConfig.length && <p>{t("common.noData")}</p>}
      <div className="auxiliary-task-list">
        {auxConfig.map((task) => {
          const labels = auxTaskLabels[task.task];
          if (!labels) return null;
          const Icon = labels.icon;
          return (
            <div key={task.task} className="auxiliary-task-row">
              <div className="auxiliary-task-icon" aria-hidden="true">
                <Icon size={20} />
              </div>
              <div className="auxiliary-task-copy">
                <h3>{t(labels.name)}</h3>
                <p className="settings-field-hint">{t(labels.hint)}</p>
              </div>
              <div className="aux-task-details">
                <span className="aux-task-provider">
                  {task.provider === "auto"
                    ? t("common.defaultModel")
                    : t(PROVIDERS.labels[task.provider] || task.provider)}
                </span>
                {task.provider !== "auto" && task.model && (
                  <span className="aux-task-model">{task.model}</span>
                )}
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => openAuxEdit(task.task)}
                aria-label={`${t("common.edit")} ${t(labels.name)}`}
              >
                <Pencil size={14} aria-hidden="true" /> {t("common.edit")}
              </button>
            </div>
          );
        })}
      </div>

      {showAuxModal && (
        <div
          className="models-modal-overlay auxiliary-modal-overlay"
          onClick={closeAuxModal}
        >
          <div
            className="models-modal auxiliary-modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auxiliary-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeAuxModal();
              }
              if (event.key !== "Tab") return;
              const controls = modalRef.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input, select",
              );
              if (!controls?.length) return;
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              }
              if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="models-modal-header">
              <h2 className="models-modal-title" id="auxiliary-dialog-title">
                {t("constants.auxiliaryTitle")} -{" "}
                {t(auxTaskLabels[auxEditingTask || ""]?.name || "")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeAuxModal}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label" htmlFor="aux-provider">
                  {t("constants.auxiliaryProviderLabel")}
                </label>
                <select
                  id="aux-provider"
                  className="input"
                  value={auxFormProvider}
                  onChange={(e) => {
                    const nextProvider = e.target.value;
                    setAuxFormProvider(nextProvider);
                    const localPreset = localPresetForProvider(nextProvider);
                    if (localPreset) {
                      setAuxFormBaseUrl(localPreset.baseUrl);
                    } else if (nextProvider !== "custom") {
                      setAuxFormBaseUrl("");
                    }
                  }}
                >
                  <option value="auto">{t("constants.auxiliaryAuto")}</option>
                  {PROVIDERS.options.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                </select>
              </div>

              {auxFormProvider !== "auto" && (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label" htmlFor="aux-model">
                      {t("constants.auxiliaryModelLabel")}
                    </label>
                    <div className="settings-model-row">
                      <input
                        className="input"
                        type="text"
                        value={auxFormModel}
                        id="aux-model"
                        onChange={(e) => setAuxFormModel(e.target.value)}
                        placeholder="e.g. gpt-4o-mini"
                        autoComplete="off"
                      />
                      {auxDiscovery.status !== "unsupported" &&
                        auxDiscovery.status !== "idle" && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setAuxDiscoveryRefresh((n) => n + 1)}
                            disabled={auxDiscovery.status === "loading"}
                            title={t("settings.refreshModels")}
                          >
                            ↻
                          </button>
                        )}
                    </div>
                    {auxDiscovery.models.length > 0 && (
                      <select
                        className="input auxiliary-discovered-models"
                        aria-label={t("constants.auxiliaryModelLabel")}
                        value={
                          auxDiscovery.models.includes(auxFormModel)
                            ? auxFormModel
                            : ""
                        }
                        onChange={(event) =>
                          setAuxFormModel(event.target.value)
                        }
                      >
                        <option value="" disabled>
                          {t("constants.auxiliaryModelLabel")}
                        </option>
                        {auxDiscovery.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    )}
                    {auxDiscovery.status !== "idle" &&
                      auxDiscovery.status !== "unsupported" && (
                        <span className="models-modal-hint">
                          {auxDiscovery.status === "loading"
                            ? t("settings.discoveringModels")
                            : auxDiscovery.status === "ok"
                              ? t("settings.discoveredCount", {
                                  count: auxDiscovery.models.length,
                                })
                              : auxDiscovery.status === "no-key"
                                ? t("settings.discoveryNoKey")
                                : auxDiscovery.status === "error"
                                  ? t("settings.discoveryError")
                                  : ""}
                        </span>
                      )}
                  </div>

                  {(auxFormProvider === "custom" ||
                    localPresetForProvider(auxFormProvider)) && (
                    <div className="models-modal-field">
                      <label
                        className="models-modal-label"
                        htmlFor="aux-base-url"
                      >
                        {t("constants.auxiliaryBaseUrlLabel")}
                      </label>
                      <input
                        className="input"
                        type="text"
                        value={auxFormBaseUrl}
                        id="aux-base-url"
                        onChange={(e) => setAuxFormBaseUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="models-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={closeAuxModal}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAuxSave}
                disabled={saving}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AuxiliaryTasksSection;
