import { useI18n } from "../useI18n";
import { setAnalyticsConsent } from "../../utils/analytics";
import { useSettings } from "./SettingsDataContext";

/** Anonymous usage analytics consent. */
export default function PrivacyPane(): React.JSX.Element {
  const { t } = useI18n();
  const { analyticsEnabled, setAnalyticsEnabled } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-row">
        <div className="settings-row-text">
          <label className="settings-row-label" htmlFor="analytics-enabled">
            {t("settings.analytics.label")}
          </label>
          <div className="settings-field-hint" id="analytics-disclosure">
            {t("settings.analytics.hint")}
          </div>
        </div>
        <input
          id="analytics-enabled"
          type="checkbox"
          aria-label={t("settings.analytics.label")}
          aria-describedby="analytics-disclosure"
          checked={analyticsEnabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            setAnalyticsEnabled(enabled);
            setAnalyticsConsent(enabled);
          }}
        />
      </div>
    </div>
  );
}
