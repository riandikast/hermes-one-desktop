import { useState } from "react";
import { Wrench } from "lucide-react";
import { useFileAutosaveDefault } from "./fileAutosave";
import { useSendConfirm } from "./sendConfirm";

/**
 * Utilities that shape how the app's built-in tools behave. Starts with the
 * default save mode for the file editor; per-file overrides live in the
 * editor's own toolbar.
 */
export default function UtilsPane(): React.JSX.Element {
  const [autoSave, setAutoSave] = useFileAutosaveDefault();
  const [saveError, setSaveError] = useState(false);
  const [sendConfirm, setSendConfirm] = useSendConfirm();
  const [confirmError, setConfirmError] = useState(false);

  const choose = (next: boolean): void => {
    if (next === autoSave) return;
    setSaveError(!setAutoSave(next));
  };

  const chooseConfirm = (next: boolean): void => {
    if (next === sendConfirm) return;
    setConfirmError(!setSendConfirm(next));
  };

  return (
    <div className="settings-pane">
      <header className="settings-pane-head">
        <h2>
          <Wrench size={18} aria-hidden="true" /> Utils
        </h2>
        <p className="settings-pane-subtitle">
          Defaults for the app&rsquo;s built-in tools. Individual files can
          override the editor behaviour from the editor toolbar.
        </p>
      </header>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">File editor auto-save</div>
            <div className="settings-row-hint">
              {saveError
                ? "Could not save the editor preference."
                : "Newly opened files save 500 ms after the last keystroke. Turn it off to save manually with the toolbar button or Ctrl+S."}
            </div>
          </div>
          <div
            className="settings-seg"
            role="group"
            aria-label="Default file editor auto-save"
          >
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`settings-seg-btn ${autoSave === value ? "active" : ""}`}
                aria-pressed={autoSave === value}
                onClick={() => choose(value)}
              >
                {value ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Send prompt confirmation</div>
            <div className="settings-row-hint">
              {confirmError
                ? "Could not save the send preference."
                : "Off (default): Enter sends immediately. On: the first Enter asks again — naming the target project — before the prompt is sent."}
            </div>
          </div>
          <div
            className="settings-seg"
            role="group"
            aria-label="Send prompt confirmation"
          >
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`settings-seg-btn ${sendConfirm === value ? "active" : ""}`}
                aria-pressed={sendConfirm === value}
                onClick={() => chooseConfirm(value)}
              >
                {value ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
