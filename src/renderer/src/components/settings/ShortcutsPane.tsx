import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, RotateCcw } from "lucide-react";
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

export default function ShortcutsPane(): React.JSX.Element {
  const { t } = useI18n();
  const overrides = useKeyboardShortcuts();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recordingRef = useRef<ShortcutId | null>(null);
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

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      // Capture phase keeps the composer/editor from consuming the chord.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { stop(); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        void apply({ ...overrides, [recording]: [] }).then((ok) => { if (ok) stop(); });
        return;
      }
      const parsed = bindingFromEvent(event, platform);
      if (parsed.error) { setError(parsed.error); return; }
      if (!parsed.binding) return;
      const conflict = SHORTCUTS.find((item) => item.id !== recording &&
        bindingsFor(item.id, overrides, platform).some((binding) => sameBinding(binding, parsed.binding!)));
      if (conflict) {
        setError(`${LABELS[conflict.id]} already uses ${display(parsed.binding, platform)}.`);
        return;
      }
      void apply({ ...overrides, [recording]: [parsed.binding] }).then((ok) => { if (ok) stop(); });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, overrides, platform, apply, stop]);

  const begin = (id: ShortcutId): void => {
    setError("");
    setRecording(id);
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
          Select Change, then press the new combination. Escape cancels; Backspace
          clears the binding. Menu accelerators follow these values.
        </p>
      </header>

      {error && <p className="settings-shortcut-error" role="alert">{error}</p>}
      {recording && (
        <p className="settings-shortcut-recording" role="status">
          Recording {LABELS[recording]} — press a key combination.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.owner} className="settings-group">
          <div className="settings-shortcut-group-title">{group.title}</div>
          {SHORTCUTS.filter((item) => item.owner === group.owner).map((item) => {
            const bindings = bindingsFor(item.id, overrides, platform);
            const isCustom = Object.prototype.hasOwnProperty.call(overrides, item.id);
            const isRecording = recording === item.id;
            return (
              <div className="settings-row settings-shortcut-row" key={item.id}>
                <div className="settings-row-text">
                  <div className="settings-row-label">{LABELS[item.id]}</div>
                </div>
                <div className="settings-shortcut-actions">
                  <span className={`settings-shortcut-keys${isRecording ? " is-recording" : ""}`}>
                    {isRecording
                      ? "Press keys…"
                      : bindings.length > 0
                        ? bindings.map((binding) => <kbd key={binding}>{display(binding, platform)}</kbd>)
                        : <span className="settings-shortcut-unset">Unassigned</span>}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busy || (recording !== null && !isRecording)}
                    onClick={() => (isRecording ? stop() : begin(item.id))}
                  >
                    {isRecording ? "Cancel" : "Change"}
                  </button>
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
