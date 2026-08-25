import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Asterisk, Search, Pencil, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import type { ModelGroup } from "./types";
import { effectiveProviderForModel } from "./hooks/useModelConfig";

interface ModelPickerProps {
  active?: boolean;
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (provider: string, model: string, baseUrl: string) => void;
}

export const ModelPicker = memo(function ModelPicker({
  active = true,
  currentModel,
  currentProvider,
  currentBaseUrl,
  modelGroups,
  displayModel,
  onOpen,
  onSelectModel,
}: ModelPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  // Left-rail provider filter (brand id); null = "All models".
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<{ id: string; model: string } | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    if (!active) return;
    function handleExternalOpen(): void {
      onOpenRef.current();
      setIsOpen(true);
      setSearchInput("");
      setSelectedBrand(null);
    }
    window.addEventListener("model-picker:open", handleExternalOpen);
    return () =>
      window.removeEventListener("model-picker:open", handleExternalOpen);
  }, [active]);

  const searchQuery = searchInput.trim().toLowerCase();
  const filteredGroups = searchQuery
    ? modelGroups
        .map((group) => ({
          ...group,
          models: group.models.filter(
            (m) =>
              m.label.toLowerCase().includes(searchQuery) ||
              m.model.toLowerCase().includes(searchQuery),
          ),
        }))
        .filter((group) => group.models.length > 0)
    : modelGroups;

  function groupKeyOf(g: { provider: string; providerLabel: string }): string {
    // Custom-named providers (e.g. 9router) share provider "custom" but must get
    // distinct rail entries. Use the label as the key for those; otherwise the
    // brand is the key.
    const genericCustomLabel = "OpenAI Compatible / Local";
    if (g.provider === "custom" && g.providerLabel && g.providerLabel !== genericCustomLabel) {
      return `label:${g.providerLabel}`;
    }
    return `brand:${g.provider}`;
  }
  // Left rail: one entry per provider group present (post-search) + counts.
  // `groupKey` disambiguates multiple custom providers that otherwise all share
  // brand "custom". Previously the rail used `brand` as its key, which collapsed
  // every custom provider into one entry with a combined count.
  const railProviders = filteredGroups.map((g) => ({
    brand: g.provider,
    label: g.providerLabel,
    groupKey: groupKeyOf(g),
    count: g.models.length,
  }));
  // Flat model rows carrying their groupKey + brand/display label for the right pane.
  // Each row keeps its raw provider/baseUrl so selection routing is unchanged.
  // `groupKey` is the rail identity (brand vs. custom label), `brand` keeps the
  // logo mapping.
  const allRows = filteredGroups.flatMap((g) =>
    g.models.map((m) => ({
      ...m,
      brand: g.provider,
      providerLabel: g.providerLabel,
      groupKey: groupKeyOf(g),
    })),
  );
  // Ignore a stale brand filter once search narrows it away → fall back to All.
  // Named custom providers share brand "custom" so filtering must use groupKey
  // (label:<name>), not brand. `selectedBrand` is kept as the state name for
  // backward compat but now holds a groupKey.
  const activeBrand =
    selectedBrand && railProviders.some((p) => p.groupKey === selectedBrand)
      ? selectedBrand
      : null;
  const filteredRows = activeBrand
    ? allRows.filter((r) => r.groupKey === activeBrand)
    : allRows;

  // Surface the current selection first. Rank: exact match (provider+model+URL)
  // → same provider+model → everything else, keeping the original order within
  // each rank so the rest of the list is unchanged.
  const isSelected = (m: { provider: string; model: string }): boolean =>
    currentModel === m.model && currentProvider === m.provider;
  const rank = (m: {
    provider: string;
    model: string;
    baseUrl: string;
  }): number => {
    if (!isSelected(m)) return 2;
    return !currentBaseUrl || (m.baseUrl || "") === currentBaseUrl ? 0 : 1;
  };
  const visibleRows = filteredRows
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);

  function toggle(): void {
    if (!isOpen) onOpen();
    setIsOpen((v) => !v);
    setSearchInput("");
    setSelectedBrand(null);
  }

  function select(
    provider: string,
    model: string,
    baseUrl: string,
    providerLabel?: string,
  ): void {
    onSelectModel(effectiveProviderForModel(provider, providerLabel), model, baseUrl);
    setIsOpen(false);
    setSearchInput("");
    setSelectedBrand(null);
  }

  function openAliasEditor(model: { id?: string; model: string; label: string }): void {
    if (!model.id) return;
    setEditingModel({ id: model.id, model: model.model });
    setAliasInput(model.label === model.model ? "" : model.label);
  }

  async function saveAlias(): Promise<void> {
    if (!editingModel) return;
    await window.hermesAPI.updateModel(editingModel.id, {
      name: aliasInput.trim() || editingModel.model,
    });
    setEditingModel(null);
    onOpenRef.current();
  }

  // Navigate to the Providers screen (keys + models management) and close.
  function goConfigure(): void {
    setIsOpen(false);
    window.dispatchEvent(
      new CustomEvent("navigation:goto", { detail: "providers" }),
    );
  }

  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button className="chat-model-trigger" onClick={toggle}>
        <span className="chat-model-name">{displayModel}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div
          className="chat-model-dropdown chat-model-dropdown-wide"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          <div className="chat-model-search-wrap">
            <Search size={14} className="chat-model-search-icon" aria-hidden />
            <input
              ref={searchRef}
              className="chat-model-search-input"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setIsOpen(false);
                }
              }}
              placeholder={t("chat.searchModels")}
            />
          </div>

          <div className="chat-model-panes">
            {/* Left rail: scrollable brand list + a pinned Configure footer */}
            <div className="chat-model-rail">
              <div className="chat-model-rail-list">
                <button
                  type="button"
                  className={`chat-model-rail-item ${activeBrand === null ? "active" : ""}`}
                  onClick={() => setSelectedBrand(null)}
                >
                  <span className="chat-model-rail-all-icon" aria-hidden>
                    <Asterisk size={12} />
                  </span>
                  <span className="chat-model-rail-label">
                    {t("chat.allModels")}
                  </span>
                  <span className="chat-model-rail-count">
                    {allRows.length}
                  </span>
                </button>
                {railProviders.map((p) => (
                  <button
                    key={p.groupKey}
                    type="button"
                    className={`chat-model-rail-item ${activeBrand === p.groupKey ? "active" : ""}`}
                    onClick={() =>
                      setSelectedBrand((cur) =>
                        cur === p.groupKey ? null : p.groupKey,
                      )
                    }
                  >
                    <BrandLogo provider={p.brand} size={16} matchTheme />
                    <span className="chat-model-rail-label">{t(p.label)}</span>
                    <span className="chat-model-rail-count">{p.count}</span>
                  </button>
                ))}
              </div>

              {/* Pinned footer — manage keys + the model library on Providers */}
              <button
                type="button"
                className="chat-model-configure"
                onClick={goConfigure}
              >
                {t("chat.configure")}
              </button>
            </div>

            {/* Right pane: flat model list for the active filter */}
            <div className="chat-model-list">
              {visibleRows.length === 0 ? (
                <div className="chat-model-list-empty">
                  {t("chat.noModelsMatch")}
                </div>
              ) : (
                visibleRows.map((m) => {
                  const isActive = isSelected(m);
                  return (
                    <button
                      type="button"
                      key={m.id || `${m.provider}:${m.providerLabel}:${m.model}:${m.baseUrl}`}
                      className={`chat-model-row ${isActive ? "active" : ""}`}
                      onClick={() => select(m.provider, m.model, m.baseUrl, m.providerLabel)}
                    >
                      <span className="chat-model-row-body">
                        <span className="chat-model-row-title">{m.label}</span>
                        <span className="chat-model-row-sub">
                          {t(m.providerLabel)} · {m.model}
                        </span>
                      </span>
                      <span
                        className="chat-model-row-alias"
                        role="button"
                        tabIndex={0}
                        title="Rename model"
                        aria-label="Rename model"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAliasEditor(m);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            openAliasEditor(m);
                          }
                        }}
                      >
                        <Pencil size={13} />
                      </span>
                      {isActive && (
                        <Check
                          size={16}
                          className="chat-model-row-check"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {editingModel && (
            <div
              className="chat-model-alias-editor"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="chat-model-alias-header">
                <strong>Rename model</strong>
                <span
                  className="chat-model-row-alias"
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingModel(null)}
                  aria-label="Close"
                >
                  <X size={15} />
                </span>
              </div>
              <div className="chat-model-alias-model">{editingModel.model}</div>
              <input
                className="input"
                autoFocus
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Display name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveAlias();
                  if (e.key === "Escape") setEditingModel(null);
                }}
              />
              <div className="chat-model-alias-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingModel(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void saveAlias()}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
