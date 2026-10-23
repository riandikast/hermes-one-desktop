import { useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import type { GitHubAuthStatus } from "../../../../shared/github-auth";

type Busy = "status" | "signin" | null;

/** A health row: label + coloured pill, so state is readable at a glance. */
function HealthRow({
  label,
  ok,
  text,
}: {
  label: string;
  ok: boolean | null;
  text: string;
}): React.JSX.Element {
  return (
    <div className="settings-row github-health-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
      </div>
      <span className={`github-pill ${ok === null ? "is-neutral" : ok ? "is-ok" : "is-bad"}`}>
        {text}
      </span>
    </div>
  );
}

/** Loading skeleton — the pane rendered nothing at all while status resolved. */
function PaneSkeleton(): React.JSX.Element {
  return (
    <div className="settings-card github-card" aria-hidden="true">
      <div className="settings-card-head">
        <div className="settings-card-icon github-skeleton-dot" />
        <div className="settings-card-headtext">
          <div className="github-skeleton-line" style={{ width: "42%" }} />
          <div className="github-skeleton-line" style={{ width: "68%" }} />
        </div>
      </div>
      <div className="settings-card-body">
        {[0, 1, 2].map((i) => (
          <div className="github-skeleton-line" key={i} style={{ width: `${88 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export default function GitHubPane(): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubAuthStatus>();
  const [busy, setBusy] = useState<Busy>("status");
  const [error, setError] = useState(false);
  // Disconnecting deletes a stored credential, so it is a two-step action
  // rather than a single click on a button next to "Sign in".
  const [confirming, setConfirming] = useState<string | null>(null);
  const mounted = useRef(true);

  async function disconnect(account: string): Promise<void> {
    setBusy("status");
    setError(false);
    try {
      const next = await window.hermesAPI.githubAuthDisconnect(account);
      if (mounted.current) {
        setStatus(next);
        setConfirming(null);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function check(signIn = false, username?: string): Promise<void> {
    setBusy(signIn ? "signin" : "status");
    setError(false);
    try {
      const next = await (username ? window.hermesAPI.githubAuthSelectAccount(username) : signIn ? window.hermesAPI.githubAuthSignIn() : window.hermesAPI.githubAuthStatus());
      if (mounted.current) setStatus(next);
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(null); }
  }
  useEffect(() => {
    mounted.current = true;
    void check();
    return () => { mounted.current = false; void window.hermesAPI.githubAuthCancel().catch(() => {}); };
  }, []);
  const accounts = [
    ...new Set([
      ...(status?.accounts || []),
      ...(status?.selectedAccount ? [status.selectedAccount] : []),
    ]),
  ];
  const message = error ? "failed" : status?.error;
  // A failed first check must NOT keep the skeleton up forever: that is how the
  // pane used to swallow "IPC unavailable" and every other status error.
  const loading = busy === "status" && !status && !message;
  return (
    <div className="settings-modal-pane github-pane">
      <h2 className="settings-field-label">GitHub</h2>
      <p className="settings-field-hint">{t("settings.github.scope")}</p>
      <div role="status" aria-live="polite" aria-busy={busy !== null}>
        {loading ? (
          <PaneSkeleton />
        ) : (
          status && (
            <div className="settings-card github-card">
              <div className="settings-card-head">
                <div className="settings-card-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </div>
                <div className="settings-card-headtext">
                  <div className="settings-card-title">
                    {status.account || t("settings.github.connection")}
                  </div>
                  <div className="settings-card-sub">{t(`settings.github.${status.auth}`)}</div>
                </div>
                <span
                  className={`settings-card-badge ${status.auth === "authenticated" ? "is-update" : "is-ok"}`}
                >
                  {t(
                    `settings.github.${status.auth === "authenticated" ? "installed" : "unverified"}`,
                  )}
                </span>
              </div>

              <div className="settings-card-body">
                <div className="github-health">
                  <HealthRow
                    label="Git"
                    ok={status.git}
                    text={t(`settings.github.${status.git ? "installed" : "missing"}`)}
                  />
                  <HealthRow
                    label="Git Credential Manager"
                    ok={status.manager}
                    text={t(`settings.github.${status.manager ? "installed" : "missing"}`)}
                  />
                  <HealthRow
                    label={t("settings.github.helper")}
                    ok={status.helper}
                    text={t(`settings.github.${status.helper ? "configured" : "notConfigured"}`)}
                  />
                </div>

                {status.manager && (
                  <div className="github-account">
                    <label className="settings-field-label" htmlFor="github-account-select">
                      {t("settings.github.account")}
                    </label>
                    <select
                      id="github-account-select"
                      className="github-select"
                      aria-label={t("settings.github.account")}
                      disabled={busy !== null}
                      value={status.selectedAccount || ""}
                      onChange={(event) => void check(false, event.target.value)}
                    >
                      <option value="" disabled>
                        {t("settings.github.selectAccount")}
                      </option>
                      {accounts.map((account) => (
                        <option key={account} value={account}>
                          {account}
                        </option>
                      ))}
                    </select>
                    {status.selectedAccount && confirming !== status.selectedAccount && (
                      <div className="github-account-actions">
                        <button
                          type="button"
                          className="btn btn-secondary github-disconnect"
                          disabled={busy !== null}
                          onClick={() => setConfirming(status.selectedAccount ?? null)}
                        >
                          {t("settings.github.disconnect")}
                        </button>
                      </div>
                    )}
                    {confirming && confirming === status.selectedAccount && (
                      <div className="github-confirm" role="alertdialog" aria-live="polite">
                        <p className="github-confirm-text">
                          {t("settings.github.confirming", { account: confirming })}
                        </p>
                        <div className="github-account-actions">
                          <button
                            type="button"
                            className="btn github-disconnect"
                            disabled={busy !== null}
                            onClick={() => void disconnect(confirming)}
                          >
                            {t("settings.github.disconnect")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busy !== null}
                            onClick={() => setConfirming(null)}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="settings-field-hint">{t("settings.github.consent")}</p>
                  </div>
                )}

                {!status.manager && (
                  <p className="settings-field-hint">{t("settings.github.installHint")}</p>
                )}

                <div className="settings-card-actions github-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy !== null || !status.manager}
                    onClick={() => void check(true)}
                  >
                    {t("settings.github.signIn")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void check()}
                  >
                    {t("settings.github.verify")}
                  </button>
                  {busy !== null && (
                    <>
                      <span className="github-inline-busy">
                        {t(`settings.github.${busy === "signin" ? "signingIn" : "checking"}`)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          void window.hermesAPI.githubAuthCancel().catch(() => setError(true))
                        }
                      >
                        {t("common.cancel")}
                      </button>
                    </>
                  )}
                </div>

                {message && (
                  <p className="github-alert" role="alert">
                    {t(`settings.github.${message}`)}
                  </p>
                )}
              </div>
            </div>
          )
        )}
        {/* Status unavailable (IPC failure): no card to host the message, but the
            reason must still be visible and the actions must stay reachable. */}
        {!loading && !status && message && (
          <p className="github-alert" role="alert">
            {t(`settings.github.${message}`)}
          </p>
        )}
        {!loading && !status && message && (
          <div className="github-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled
              title={t(`settings.github.${message}`)}
            >
              {t("settings.github.signIn")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => void check()}
            >
              {t("settings.github.verify")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
