import { useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import type { GitHubAuthStatus } from "../../../../shared/github-auth";

export default function GitHubPane(): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubAuthStatus>();
  const [busy, setBusy] = useState<"status" | "signin" | null>("status");
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  async function check(signIn = false): Promise<void> {
    setBusy(signIn ? "signin" : "status");
    setError(false);
    try {
      const next = await (signIn ? window.hermesAPI.githubAuthSignIn() : window.hermesAPI.githubAuthStatus());
      if (mounted.current) setStatus(next);
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(null); }
  }
  useEffect(() => {
    mounted.current = true;
    void check();
    return () => { mounted.current = false; void window.hermesAPI.githubAuthCancel().catch(() => {}); };
  }, []);
  return <div className="settings-modal-pane">
    <h2 className="settings-field-label">GitHub</h2>
    <p className="settings-field-hint">{t("settings.github.scope")}</p>
    <div role="status" aria-live="polite" aria-busy={busy !== null}>
      {busy && <p>{t(`settings.github.${busy === "signin" ? "signingIn" : "checking"}`)}</p>}
      {status && <>
        <div className="settings-row"><span>Git</span><span>{t(`settings.github.${status.git ? "installed" : "missing"}`)}</span></div>
        <div className="settings-row"><span>Git Credential Manager</span><span>{t(`settings.github.${status.manager ? "installed" : "missing"}`)}</span></div>
        <div className="settings-row"><span>{t("settings.github.helper")}</span><span>{t(`settings.github.${status.helper ? "configured" : "notConfigured"}`)}</span></div>
        <div className="settings-row"><span>{t("settings.github.connection")}</span><span>{t(`settings.github.${status.auth}`)}{status.account ? ` (${status.account})` : ""}</span></div>
      </>}
    </div>
    {(error || status?.error) && <p role="alert">{t(`settings.github.${status?.error || "failed"}`)}</p>}
    {status && !status.manager && <p className="settings-field-hint">{t("settings.github.installHint")}</p>}
    <p className="settings-field-hint">{t("settings.github.consent")}</p>
    <div className="settings-seg">
      <button type="button" disabled={busy !== null || !status?.manager} onClick={() => void check(true)}>{t("settings.github.signIn")}</button>
      <button type="button" disabled={busy !== null} onClick={() => void check()}>{t("settings.github.verify")}</button>
      {busy === "signin" && <button type="button" onClick={() => void window.hermesAPI.githubAuthCancel().catch(() => setError(true))}>{t("common.cancel")}</button>}
    </div>
  </div>;
}
