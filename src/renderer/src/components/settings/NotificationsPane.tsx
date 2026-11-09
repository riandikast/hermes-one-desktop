import { useEffect, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "../../../../shared/notifications";
import { useI18n } from "../useI18n";

/**
 * Settings → Notifications (device-local, adopted from the official desktop).
 *
 * Two groups, like the official page: Alerts (OS notifications per kind) and
 * Sounds (the in-app finish chime). Every switch persists immediately — there
 * is no Save button because nothing here touches config.yaml or the backend.
 */
export default function NotificationsPane(): React.JSX.Element {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");
  const copy = (key: string, fallback: string): string =>
    t(`settings.notifications.${key}`, { defaultValue: fallback });

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI
      .getNotificationPrefs()
      .then((next) => {
        if (!cancelled) {
          setPrefs(next);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy("loadError", "Could not read this computer's notification settings."));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function update(patch: Partial<NotificationPrefs>): Promise<void> {
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setSaving(true);
    setError("");
    setTestResult("");
    try {
      const stored = await window.hermesAPI.setNotificationPrefs(next);
      setPrefs(stored);
      window.dispatchEvent(
        new CustomEvent("notification-prefs:changed", { detail: stored }),
      );
    } catch {
      setPrefs(previous);
      setError(copy("saveError", "Could not save this preference."));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(): Promise<void> {
    setTestResult("");
    setError("");
    try {
      const result = await window.hermesAPI.showTestNotification(
        copy("testTitle", "Hermes One"),
        copy("testBody", "Notifications are working."),
      );
      setTestResult(
        result.shown
          ? copy("testSent", "Test notification sent.")
          : result.reason ?? copy("testBlocked", "Notifications are switched off for this kind."),
      );
    } catch {
      setError(copy("testError", "Could not raise a test notification."));
    }
  }

  return (
    <div className="settings-modal-pane">
      <p className="settings-field-hint">
        {copy(
          "scope",
          "These switches apply to this computer only. OS notifications appear when a turn finishes or fails while Hermes One is in the background.",
        )}
      </p>

      {error && <div role="alert" className="settings-field-hint">{error}</div>}

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <label className="settings-row-label" htmlFor="notifications-enabled">
              {copy("enableAll", "Desktop notifications")}
            </label>
            <div className="settings-row-hint">
              {copy("enableAllHint", "Master switch for every alert on this computer.")}
            </div>
          </div>
          <label className="tools-toggle">
            <input
              id="notifications-enabled"
              type="checkbox"
              disabled={!loaded || saving}
              checked={prefs.enabled}
              onChange={(event) => void update({ enabled: event.target.checked })}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <label className="settings-row-label" htmlFor="notifications-complete">
              {copy("turnComplete", "Turn finished")}
            </label>
            <div className="settings-row-hint">
              {copy("turnCompleteHint", "A reply is ready and the window is not focused.")}
            </div>
          </div>
          <label className="tools-toggle">
            <input
              id="notifications-complete"
              type="checkbox"
              disabled={!loaded || saving || !prefs.enabled}
              checked={prefs.onTurnComplete}
              onChange={(event) => void update({ onTurnComplete: event.target.checked })}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <label className="settings-row-label" htmlFor="notifications-error">
              {copy("turnError", "Turn failed")}
            </label>
            <div className="settings-row-hint">
              {copy("turnErrorHint", "A turn stopped with an error while you were elsewhere.")}
            </div>
          </div>
          <label className="tools-toggle">
            <input
              id="notifications-error"
              type="checkbox"
              disabled={!loaded || saving || !prefs.enabled}
              checked={prefs.onTurnError}
              onChange={(event) => void update({ onTurnError: event.target.checked })}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">{copy("test", "Send a test notification")}</span>
            <div className="settings-row-hint">
              {testResult || copy("testHint", "Confirms this computer accepts Hermes One notifications.")}
            </div>
          </div>
          <div className="settings-agent-control">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!loaded}
              onClick={() => void sendTest()}
            >
              {copy("testAction", "Send test")}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <label className="settings-row-label" htmlFor="notifications-sound">
              {copy("soundEnabled", "Finish chime")}
            </label>
            <div className="settings-row-hint">
              {copy("soundEnabledHint", "Plays a short tone when a turn ends in an open chat.")}
            </div>
          </div>
          <label className="tools-toggle">
            <input
              id="notifications-sound"
              type="checkbox"
              disabled={!loaded || saving}
              checked={prefs.soundEnabled}
              onChange={(event) => void update({ soundEnabled: event.target.checked })}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>
      </div>
    </div>
  );
}
