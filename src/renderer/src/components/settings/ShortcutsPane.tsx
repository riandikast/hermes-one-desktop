import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Plus, RotateCcw } from "lucide-react";
import {
  SHORTCUTS,
  bindingsFor,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../../../shared/keyboard-shortcuts";
import {
  saveKeyboardShortcuts,
  setShortcutRecording,
  shortcutPlatform,
  useKeyboardShortcuts,
} from "../../utils/keyboardShortcuts";
import { useI18n } from "../useI18n";

/** Display names stay literal product copy, like the other settings rows. */
const LABELS: Record<ShortcutId, string> = {
  newChat: "New chat",
  searchSessions: "Search sessions",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Actual size",
  fullscreen: "Toggle full screen",
  minimize: "Minimize window",
  closeWindow: "Close window",
  reload: "Reload window",
  devTools: "Toggle developer tools",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
  settings: "Open settings",
  searchFiles: "Search file names",
  searchContents: "Search file contents",
  switchProfile: "Switch profile",
  toggleTerminal: "Toggle terminal",
  sendMessage: "Send message",
  clarifySubmit: "Submit clarification",
  gitCommit: "Commit staged changes",
  closeTab: "Close tab",
  nextTab: "Next tab",
  previousTab: "Previous tab",
  tab1: "Go to tab 1",
  tab2: "Go to tab 2",
  tab3: "Go to tab 3",
  tab4: "Go to tab 4",
  tab5: "Go to tab 5",
  tab6: "Go to tab 6",
  tab7: "Go to tab 7",
  tab8: "Go to tab 8",
  tab9: "Go to tab 9",
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead"]);
/** Bare keys that cannot hijack ordinary typing. */
const UNMODIFIED = /^(?:Enter|Tab|Escape|Space|Delete|F(?:[1-9]|1[0-9]|2[0-4]))$/;

function normalizeKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null;
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Canonical, platform-aware binding from a real key event. */
export function bindingFromEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  platform = shortcutPlatform(),
): { binding?: string; error?: string } {
  const key = normalizeKey(event.key);
  if (!key) return {};
  const parts: string[] = [];
  if ((event.ctrlKey && platform !== "darwin") || (event.metaKey && platform === "darwin")) parts.push("Mod");
  else {
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Meta");
  }
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  const binding = parts.join("+");
  if (parts.length === 1 && !UNMODIFIED.test(key)) {
    return { error: "Add a modifier (Ctrl, Alt or Shift) unless the key is Enter, Tab, Escape, Delete or a function key." };
  }
  return { binding };
}

function display(binding: string, platform: string): string {
  return binding.replace(/\bMod\b/g, platform === "darwin" ? "Cmd" : "Ctrl");
}

function sameBinding(a: string, b: string): boolean {
  const norm = (value: string): string => {
    const parts = value.split("+");
    const key = parts.at(-1) ?? "";
    return [...parts.slice(0, -1).sort(), key.toLowerCase()].join("+");
  };
  return norm(a) === norm(b);
}

/** A row's chord slot: an existing index, or a new binding to append. */
type RecordTarget = { id: ShortcutId; index: number | "new" };

export default function ShortcutsPane(): React.JSX.Element {
  const { t } = useI18n();
  const overrides = useKeyboardShortcuts();
  const [recording, setRecording] = useState<RecordTarget | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recordingRef = useRef<RecordTarget | null>(null);
  recordingRef.current = recording;
  const platform = shortcutPlatform();

  const stop = useCallback((): void => {
    recordingRef.current = null;
    setRecording(null);
    setShortcutRecording(false);
  }, []);

  // A recorder must survive unmount (settings closed mid-capture).
  useEffect(() => () => {
    if (recordingRef.current) setShortcutRecording(false);
  }, []);

  const apply = useCallback(async (next: ShortcutOverrides): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await saveKeyboardShortcuts(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Replace or append ONE chord; the action's other chords stay intact. */
  const applyBinding = useCallback(async (target: RecordTarget, binding: string | null): Promise<boolean> => {
    const current = [...bindingsFor(target.id, overrides, platform)];
    if (binding === null) {
      // Backspace removes only the edited chord, never the whole command.
      if (target.index === "new" || target.index >= current.length) return true;
      current.splice(target.index, 1);
    } else if (target.index === "new" || target.index >= current.length) current.push(binding);
    else current[target.index] = binding;
    return apply({ ...overrides, [target.id]: current });
  }, [overrides, platform, apply]);

  // Capture phase keeps the composer/editor from consuming the chord.
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { stop(); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        void applyBinding(recording, null).then((ok) => { if (ok) stop(); });
        return;
      }
      const parsed = bindingFromEvent(event, platform);
      if (parsed.error) { setError(parsed.error); return; }
      if (!parsed.binding) return;
      const otherAction = SHORTCUTS.find((item) => item.id !== recording.id &&
        bindingsFor(item.id, overrides, platform).some((binding) => sameBinding(binding, parsed.binding!)));
      const sameAction = bindingsFor(recording.id, overrides, platform)
        .some((binding, index) => index !== recording.index && sameBinding(binding, parsed.binding!));
      const conflict = otherAction ? LABELS[otherAction.id] : sameAction ? LABELS[recording.id] : null;
      if (conflict) {
        setError(`${conflict} already uses ${display(parsed.binding, platform)}.`);
        return;
      }
      void applyBinding(recording, parsed.binding).then((ok) => { if (ok) stop(); });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, overrides, platform, applyBinding, stop]);

  const begin = (id: ShortcutId, index: number | "new" = 0): void => {
    setError("");
    setRecording({ id, index });
    setShortcutRecording(true);
  };

  const groups: { title: string; owner: "main" | "renderer" }[] = [
    { title: "Application", owner: "main" },
    { title: "Chat & navigation", owner: "renderer" },
  ];
  const customised = Object.keys(overrides).length > 0;

  return (
    <div className="settings-pane-shortcuts">
      <header className="settings-pane-head">
        <h2><Keyboard size={18} aria-hidden="true" /> Keyboard shortcuts</h2>
        <p className="settings-pane-subtitle">
          Select Change, or click a chord to edit just that one, then press the new
          combination. Use + to add another chord. Escape cancels; Backspace removes
          the chord being edited. Menu accelerators use each action’s first chord.
        </p>
      </header>

      {error && <p className="settings-shortcut-error" role="alert">{error}</p>}
      {recording && (
        <p className="settings-shortcut-recording" role="status">
          Recording {LABELS[recording.id]}
          {recording.index === "new" ? " (new chord)" : ` (chord ${recording.index + 1})`} — press a key combination.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.owner} className="settings-group">
          <div className="settings-shortcut-group-title">{group.title}</div>
          {SHORTCUTS.filter((item) => item.owner === group.owner).map((item) => {
            const bindings = bindingsFor(item.id, overrides, platform);
            const isCustom = Object.prototype.hasOwnProperty.call(overrides, item.id);
            const editingIndex = recording && recording.id === item.id ? recording.index : null;
            const isRecording = editingIndex !== null;
            return (
              <div className="settings-row settings-shortcut-row" key={item.id}>
                <div className="settings-row-text">
                  <div className="settings-row-label">{LABELS[item.id]}</div>
                </div>
                <div className="settings-shortcut-actions">
                  <span className={`settings-shortcut-keys${isRecording ? " is-recording" : ""}`}>
                    {isRecording && editingIndex === "new"
                      ? "Press keys…"
                      : bindings.length > 0 || isRecording
                        ? bindings.map((binding, index) => (
                            <button
                              key={`${item.id}-${index}`}
                              type="button"
                              className={`settings-shortcut-chip${editingIndex === index ? " is-recording" : ""}`}
                              title={`Change ${display(binding, platform)} for ${LABELS[item.id]}`}
                              aria-label={`Change shortcut ${display(binding, platform)} for ${LABELS[item.id]}`}
                              disabled={busy || (recording !== null && editingIndex !== index)}
                              onClick={() => (editingIndex === index ? stop() : begin(item.id, index))}
                            >
                              {editingIndex === index ? "Press keys…" : <kbd>{display(binding, platform)}</kbd>}
                            </button>
                          ))
                        : <span className="settings-shortcut-unset">Unassigned</span>}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busy || (recording !== null && !isRecording)}
                    onClick={() => (isRecording ? stop() : begin(item.id, 0))}
                  >
                    {isRecording ? "Cancel" : "Change"}
                  </button>
                  {bindings.length < 8 && (
                    <button
                      type="button"
                      className="settings-shortcut-reset"
                      title={`Add another shortcut for ${LABELS[item.id]}`}
                      aria-label={`Add shortcut for ${LABELS[item.id]}`}
                      disabled={busy || (recording !== null && !isRecording)}
                      onClick={() => (editingIndex === "new" ? stop() : begin(item.id, "new"))}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                  {isCustom && bindings.length > 0 && !isRecording && (
                    <button
                      type="button"
                      className="settings-shortcut-reset"
                      title="Restore default"
                      aria-label={`Restore default for ${LABELS[item.id]}`}
                      disabled={busy}
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[item.id];
                        void apply(next);
                      }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <div className="settings-shortcut-footer">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={!customised || busy || recording !== null}
          onClick={() => void apply({})}
        >
          {t("settings.shortcuts.resetAll")}
        </button>
      </div>
    </div>
  );
}
