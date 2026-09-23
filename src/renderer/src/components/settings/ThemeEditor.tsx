import { useState } from "react";
import { Check, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import {
  isBuiltinTheme,
  seedCustomFrom,
  THEME_VAR_LABELS,
  THEME_VAR_ORDER,
  themeAppearance,
  themeIdFromName,
  themeName,
  themeVars,
} from "../../theme/themeEditor";

const GROUPS: Array<{ title: string; vars: string[] }> = [
  {
    title: "Backgrounds",
    vars: [
      "--bg-primary",
      "--bg-secondary",
      "--bg-tertiary",
      "--bg-elevated",
      "--bg-hover",
      "--bg-active",
      "--code-bg",
      "--tool-result-bg",
    ],
  },
  {
    title: "Accent",
    vars: [
      "--accent",
      "--accent-hover",
      "--accent-subtle",
      "--accent-text",
      "--primary-yellow",
      "--selection",
    ],
  },
  {
    title: "Text & borders",
    vars: [
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--border",
      "--border-bright",
      "--border-focus",
      "--scrollbar-thumb",
      "--scrollbar-hover",
    ],
  },
  {
    title: "Status",
    vars: [
      "--success",
      "--success-bg",
      "--error",
      "--error-bg",
      "--warning",
      "--warning-bg",
    ],
  },
  {
    title: "Bubbles",
    vars: [
      "--user-bubble",
      "--user-bubble-text",
      "--agent-bubble",
      "--agent-bubble-text",
    ],
  },
];

function isColorValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  return (
    /^#([0-9a-f]{3,8})$/.test(t) ||
    /^(rgba?|hsla?|color-mix|hwb|lab|lch|oklch|oklab)\(/.test(t) ||
    /^(transparent|currentcolor)$/.test(t)
  );
}

/** Best-effort conversion for the <input type="color"> swatch only. */
function toHexColor(value: string): string {
  const t = value.trim().toLowerCase();
  const hex6 = t.match(/^#([0-9a-f]{6})$/);
  if (hex6) return `#${hex6[1]}`;
  const hex8 = t.match(/^#([0-9a-f]{8})$/);
  if (hex8) return `#${hex8[1].slice(0, 6)}`;
  const rgb = t.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) =>
      Math.max(0, Math.min(255, Number(n)))
        .toString(16)
        .padStart(2, "0"),
    );
    return `#${r}${g}${b}`;
  }
  return "#000000";
}

interface Props {
  /** Theme currently open in the editor (null = closed). */
  editingId: string | null;
  /** Switch the editor to another theme (used by "Copy"). */
  onEdit: (id: string | null) => void;
  onClose: () => void;
}

/**
 * Full-variable theme editor: edit any of the palette variables of any theme,
 * duplicate a built-in into a new custom theme, reset a built-in's overrides,
 * or delete a custom theme. Edits apply live; Save persists to localStorage.
 */
export default function ThemeEditor({
  editingId,
  onEdit,
  onClose,
}: Props): React.JSX.Element | null {
  const { theme, setTheme, customThemes, saveCustomTheme, deleteCustomTheme } =
    useTheme();
  // Draft state: null means "matching the stored/effective values".
  const [draftVars, setDraftVars] = useState<Record<string, string> | null>(
    null,
  );
  const [draftName, setDraftName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sourceId = editingId;
  const baseVars = sourceId
    ? (themeVars(sourceId, customThemes) ?? {})
    : {};
  const vars = draftVars ?? baseVars;
  const isCustom = sourceId ? !isBuiltinTheme(sourceId) : false;
  const storedName = sourceId ? themeName(sourceId, customThemes) : "";
  const name = draftName ?? storedName;
  const storedEntry = sourceId ? customThemes[sourceId] : undefined;
  const hasStoredOverride =
    !!storedEntry && Object.keys(storedEntry.vars).length > 0;
  const dirty =
    THEME_VAR_ORDER.some((v) => (vars[v] ?? "") !== (baseVars[v] ?? "")) ||
    (draftName !== null && draftName.trim() !== storedName);

  if (!sourceId) return null;

  function setVar(varName: string, value: string): void {
    setDraftVars((prev) => ({ ...(prev ?? baseVars), [varName]: value }));
  }

  function resetDrafts(): void {
    setDraftVars(null);
    setDraftName(null);
    setConfirmDelete(false);
  }

  function handleSave(): void {
    const changed: Record<string, string> = {};
    for (const v of THEME_VAR_ORDER) {
      const current = vars[v] ?? "";
      if (current !== (baseVars[v] ?? "")) changed[v] = current;
    }
    // Saving an override with zero changed vars clears the stored override.
    if (Object.keys(changed).length === 0 && !isCustom && !draftName) {
      deleteCustomTheme(sourceId!);
    } else {
      saveCustomTheme(sourceId!, {
        name: name.trim() || storedName,
        appearance: themeAppearance(sourceId!, customThemes),
        vars: changed,
      });
    }
    resetDrafts();
  }

  function handleRevert(): void {
    // Back to the pristine main.css values: drop the stored override.
    deleteCustomTheme(sourceId!);
    resetDrafts();
    onClose();
  }

  function handleDelete(): void {
    deleteCustomTheme(sourceId!);
    if (theme === sourceId) setTheme("dark");
    resetDrafts();
    onClose();
  }

  function handleDuplicate(): void {
    const base = `${name || "Theme"} Copy`;
    let id = themeIdFromName(base);
    let n = 2;
    while (id in customThemes || isBuiltinTheme(id)) {
      id = themeIdFromName(`${base} ${n++}`);
    }
    saveCustomTheme(id, seedCustomFrom(sourceId!, id, base, customThemes));
    setTheme(id);
    resetDrafts();
    // Keep editing, now on the fresh copy.
    onEdit(id);
  }

  // Live preview reflects DRAFT values via inline custom properties.
  const previewStyle = {} as React.CSSProperties;
  for (const v of THEME_VAR_ORDER) {
    if (draftVars && draftVars[v] !== undefined && draftVars[v] !== "") {
      (previewStyle as Record<string, string>)[v] = draftVars[v];
    }
  }

  return (
    <div
      className="theme-editor"
      role="dialog"
      aria-label={`Edit theme ${name}`}
    >
      <div className="theme-editor-head">
        <input
          className="input theme-editor-name"
          value={name}
          onChange={(e) => setDraftName(e.target.value)}
          aria-label="Theme name"
          spellCheck={false}
        />
        <div className="theme-editor-head-actions">
          <button
            type="button"
            className="theme-editor-btn"
            title="Duplicate this theme as a new custom theme"
            onClick={handleDuplicate}
          >
            <Plus size={14} />
            <span>Copy</span>
          </button>
          {hasStoredOverride && (
            <button
              type="button"
              className="theme-editor-btn"
              title="Discard saved overrides and return to the original values"
              onClick={handleRevert}
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          )}
          {isCustom &&
            (confirmDelete ? (
              <button
                type="button"
                className="theme-editor-btn danger"
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                <span>Confirm delete</span>
              </button>
            ) : (
              <button
                type="button"
                className="theme-editor-btn danger"
                title="Delete this custom theme"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            ))}
          <button
            type="button"
            className="theme-editor-btn"
            title="Close the editor"
            onClick={() => {
              resetDrafts();
              onClose();
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div
        className="settings-theme-preview theme-editor-preview"
        data-theme={sourceId}
        style={previewStyle}
      >
        <div className="settings-theme-preview-sidebar" />
        <div className="settings-theme-preview-main">
          <div className="settings-theme-preview-bar accent" />
          <div className="settings-theme-preview-bar text" />
          <div className="settings-theme-preview-bar" />
        </div>
      </div>

      <div className="theme-editor-vars">
        {GROUPS.map((g) => (
          <div className="theme-editor-group" key={g.title}>
            <div className="theme-editor-group-title">{g.title}</div>
            {g.vars.map((v) => (
              <label className="theme-editor-row" key={v}>
                <span className="theme-editor-var-name" title={v}>
                  {THEME_VAR_LABELS[v] ?? v.replace(/^--/, "")}
                  <code>{v}</code>
                </span>
                <span className="theme-editor-var-controls">
                  {isColorValue(vars[v] ?? "") && (
                    <input
                      type="color"
                      className="theme-editor-swatch"
                      value={toHexColor(vars[v] ?? "")}
                      onChange={(e) => setVar(v, e.target.value)}
                      title="Pick a color"
                    />
                  )}
                  <input
                    className="input theme-editor-var-input"
                    value={vars[v] ?? ""}
                    placeholder={baseVars[v] ?? ""}
                    onChange={(e) => setVar(v, e.target.value)}
                    spellCheck={false}
                  />
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="theme-editor-foot">
        <span className="theme-editor-hint">
          {dirty
            ? "Unsaved changes — visible live, persisted on Save"
            : "Edits apply live to the whole app"}
        </span>
        <button
          type="button"
          className="theme-editor-btn primary"
          onClick={handleSave}
          disabled={!dirty}
        >
          <Check size={14} />
          <span>Save theme</span>
        </button>
      </div>
    </div>
  );
}
