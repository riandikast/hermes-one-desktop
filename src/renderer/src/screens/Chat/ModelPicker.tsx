import { memo, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Asterisk,
  Search,
  Pencil,
  X,
  FolderPlus,
  FolderMinus,
  Trash2,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import type { ModelGroup } from "./types";
import {
  loadModelGroups,
  saveModelGroups,
  subscribeModelGroups,
  newGroupId,
  modelKeyOf,
  type CustomModelGroup,
} from "./modelGroups";

interface ModelPickerProps {
  active?: boolean;
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    providerLabel?: string,
  ) => void;
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
  // Frontend-only custom groups (localStorage); rows keep their own
  // provider/model/baseUrl so selection routing is never affected.
  const [customGroups, setCustomGroups] = useState<CustomModelGroup[]>([]);
  // Which group a row is being added to / removed from (row key -> group id).
  const [groupTarget, setGroupTarget] = useState<string | null>(null);
  // New-group creation flow.
  const [newGroupName, setNewGroupName] = useState("");
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

  useEffect(() => {
    const sync = (): void => setCustomGroups(loadModelGroups());
    sync();
    return subscribeModelGroups(sync);
  }, []);

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
    g.models.map((m) => {
      const key = modelKeyOf(m.provider, m.baseUrl, m.model);
      return {
        ...m,
        brand: g.provider,
        providerLabel: g.providerLabel,
        groupKey: groupKeyOf(g),
        rowKey: key,
        customGroupId: customGroups.find((cg) => cg.modelKeys.includes(key))?.id,
      };
    }),
  );
  // Ignore a stale brand filter once search narrows it away → fall back to All.
  // Named custom providers share brand "custom" so filtering must use groupKey
  // (label:<name>), not brand. `selectedBrand` is kept as the state name for
  // backward compat but now holds a groupKey.
  // Custom-group rail entries (only groups that still have at least one
  // live row — a group whose models were all removed from the picker stays
  // defined but isn't shown as an empty bucket).
  const customRail = customGroups
    .map((cg) => {
      const rows = allRows.filter((r) => r.customGroupId === cg.id);
      return { id: cg.id, name: cg.name, count: rows.length, rows };
    })
    .filter((e) => e.count > 0);
  const groupedRowKeys = new Set(
    customRail.flatMap((e) => e.rows.map((r) => r.rowKey)),
  );
  const activeBrand =
    (selectedBrand &&
      (railProviders.some((p) => p.groupKey === selectedBrand) ||
        customRail.some((c) => `custom:${c.id}` === selectedBrand))
      ? selectedBrand
      : null) ||
    null;
  const filteredRows = activeBrand
    ? activeBrand.startsWith("custom:")
      ? allRows.filter(
          (r) => r.customGroupId === activeBrand.slice("custom:".length),
        )
      // Provider entries live under "Ungrouped": show that provider's rows
      // EXCEPT ones captured by a custom group (their home is the group or
      // "All models"), matching the count shown on the rail.
      : allRows.filter(
          (r) =>
            r.groupKey === activeBrand && !groupedRowKeys.has(r.rowKey),
        )
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
    if (providerLabel) {
      onSelectModel(provider, model, baseUrl, providerLabel);
    } else {
      onSelectModel(provider, model, baseUrl);
    }
    setIsOpen(false);
    setSearchInput("");
    setSelectedBrand(null);
  }

  function mutateGroups(
    updater: (prev: CustomModelGroup[]) => CustomModelGroup[],
  ): CustomModelGroup[] {
    const prev = loadModelGroups();
    const next = updater(prev);
    saveModelGroups(next);
    setCustomGroups(next);
    return next;
  }

  function addToGroup(groupId: string, rowKey: string): void {
    // Single-membership: adding to a group pulls the row out of any other
    // first, matching the UI affordance (one folder icon per row).
    mutateGroups((prev) =>
      prev.map((g) => ({
        ...g,
        modelKeys:
          g.id === groupId
            ? [...new Set([...g.modelKeys, rowKey])]
            : g.modelKeys.filter((k) => k !== rowKey),
      })),
    );
  }

  function removeFromGroup(groupId: string, rowKey: string): void {
    mutateGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, modelKeys: g.modelKeys.filter((k) => k !== rowKey) }
          : g,
      ),
    );
  }

  function createGroup(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = newGroupId();
    mutateGroups((prev) => [...prev, { id, name: trimmed, modelKeys: [] }]);
    return id;
  }

  function deleteGroup(id: string): void {
    mutateGroups((prev) => prev.filter((g) => g.id !== id));
    if (selectedBrand === `custom:${id}`) setSelectedBrand(null);
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
                {customRail.length > 0 && (
                  <>
                    <div className="chat-model-rail-section">
                      {t("chat.customGroups")}
                    </div>
                    {customRail.map((c) => (
                      <div
                        key={c.id}
                        className={`chat-model-rail-item-holder ${activeBrand === `custom:${c.id}` ? "active" : ""}`}
                      >
                        <button
                          type="button"
                          className={`chat-model-rail-item ${activeBrand === `custom:${c.id}` ? "active" : ""}`}
                          onClick={() =>
                            setSelectedBrand((cur) =>
                              cur === `custom:${c.id}` ? null : `custom:${c.id}`,
                            )
                          }
                        >
                          <span className="chat-model-rail-all-icon" aria-hidden>
                            <FolderPlus size={12} />
                          </span>
                          <span className="chat-model-rail-label">{c.name}</span>
                          <span className="chat-model-rail-count">{c.count}</span>
                        </button>
                        <span
                          className="chat-model-rail-delete"
                          role="button"
                          tabIndex={0}
                          title={t("chat.deleteGroup")}
                          aria-label={t("chat.deleteGroup")}
                          onClick={() => deleteGroup(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              deleteGroup(c.id);
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </span>
                      </div>
                    ))}
                  </>
                )}
                <div className="chat-model-rail-section">
                  {t("chat.ungrouped")}
                </div>
                {railProviders.map((p) => {
                  const ungroupedCount =
                    p.count -
                    allRows.filter(
                      (r) =>
                        r.groupKey === p.groupKey && groupedRowKeys.has(r.rowKey),
                    ).length;
                  return (
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
                      <span className="chat-model-rail-count">{ungroupedCount}</span>
                    </button>
                  );
                })}
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
                    <div
                      key={m.id || `${m.provider}:${m.providerLabel}:${m.model}:${m.baseUrl}`}
                      className="chat-model-row-wrap"
                      style={{ position: "relative" }}
                    >
                      <button
                        type="button"
                        className={`chat-model-row ${isActive ? "active" : ""}`}
                        onClick={() => {
                          if (m.provider === "custom" && m.providerLabel) {
                            select(m.provider, m.model, m.baseUrl, m.providerLabel);
                          } else {
                            select(m.provider, m.model, m.baseUrl);
                          }
                        }}
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
                          title={t("chat.groupModels")}
                          aria-label={t("chat.groupModels")}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (m.customGroupId) {
                              removeFromGroup(m.customGroupId, m.rowKey);
                            } else {
                              setGroupTarget((cur) =>
                                cur === m.rowKey ? null : m.rowKey,
                              );
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (m.customGroupId) {
                                removeFromGroup(m.customGroupId, m.rowKey);
                              } else {
                                setGroupTarget((cur) =>
                                  cur === m.rowKey ? null : m.rowKey,
                                );
                              }
                            }
                          }}
                        >
                          {m.customGroupId ? (
                            <FolderMinus size={13} />
                          ) : (
                            <FolderPlus size={13} />
                          )}
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
                      {groupTarget === m.rowKey && (
                        <div
                          className="chat-model-group-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {customGroups.length === 0 && (
                            <div className="chat-model-group-menu-hint">
                              {t("chat.customGroupsHint")}
                            </div>
                          )}
                          {customGroups.map((cg) =>
                            cg.modelKeys.includes(m.rowKey) ? (
                              <button
                                key={cg.id}
                                type="button"
                                className="chat-model-group-menu-item danger"
                                onClick={() => {
                                  removeFromGroup(cg.id, m.rowKey);
                                  setGroupTarget(null);
                                }}
                              >
                                {t("chat.removeFromGroup")} · {cg.name}
                              </button>
                            ) : (
                              <button
                                key={cg.id}
                                type="button"
                                className="chat-model-group-menu-item"
                                onClick={() => {
                                  addToGroup(cg.id, m.rowKey);
                                  setGroupTarget(null);
                                }}
                              >
                                {t("chat.addModelsToGroup")} · {cg.name}
                              </button>
                            ),
                          )}
                          <button
                            type="button"
                            className="chat-model-group-menu-item"
                            onClick={() => {
                              const id = createGroup(newGroupName);
                              if (id) {
                                addToGroup(id, m.rowKey);
                                setNewGroupName("");
                                setGroupTarget(null);
                              }
                            }}
                          >
                            {t("chat.newGroup")}…
                          </button>
                          <input
                            className="input"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder={t("chat.groupNamePlaceholder")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const id = createGroup(newGroupName);
                                if (id) {
                                  addToGroup(id, m.rowKey);
                                  setNewGroupName("");
                                  setGroupTarget(null);
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
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
