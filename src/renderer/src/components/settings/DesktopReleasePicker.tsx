import { useEffect, useState } from "react";
import type {
  DesktopRelease,
  DesktopReleasePage,
  DesktopReleaseState,
} from "../../../../shared/desktop-releases";
import { useI18n } from "../useI18n";

export default function DesktopReleasePicker(): React.JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useState<DesktopReleasePage | null>(null);
  const [releases, setReleases] = useState<DesktopRelease[]>([]);
  const [tag, setTag] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<DesktopReleaseState>({
    phase: "idle",
    version: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = (key: string, defaultValue: string) =>
    t(`settings.releasePicker.${key}`, { defaultValue });
  useEffect(() => {
    let alive = true;
    void window.hermesAPI
      .getDesktopReleaseState()
      .then((value) => {
        if (alive) setState(value);
      })
      .catch((err) => {
        if (alive) setError(String(err));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (state.phase !== "downloading") return;
    const timer = setInterval(() => {
      void window.hermesAPI.getDesktopReleaseState().then(setState).catch(err => setError(String(err)));
    }, 1000);
    return () => clearInterval(timer);
  }, [state.phase]);
  async function load(next = 1): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.listDesktopReleases(next);
      setPage(result);
      setReleases((old) => [
        ...new Map(
          [...(next === 1 ? [] : old), ...result.releases].map((r) => [
            r.tag,
            r,
          ]),
        ).values(),
      ]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  async function act(
    action: () => Promise<DesktopReleaseState | void>,
  ): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      if (value) setState(value);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-field">
      <div className="settings-card-actions">
        <button
          className="btn btn-secondary"
          disabled={busy || state.phase !== "idle"}
          onClick={() => void load()}
        >
          {text("choose", "Choose version")}
        </button>
      </div>
      {page && !page.available && <p role="status">{page.reason}</p>}
      {page?.available && (
        <>
          <p>
            {text("installed", "Installed")}: {page.installed} ·{" "}
            {text("latest", "Latest")}: {page.latest ?? "—"}
          </p>
          <label>
            {text("version", "Windows setup version")}
            <select
              aria-label={text("version", "Windows setup version")}
              value={tag}
              disabled={busy || state.phase !== "idle"}
              onChange={(e) => {
                setTag(e.target.value);
                setConsent(false);
              }}
            >
              <option value="">{text("select", "Select a release")}</option>
              {releases.map((r) => (
                <option
                  key={r.tag}
                  value={r.tag}
                  disabled={r.version === page.installed}
                >
                  {r.version}
                  {r.version === page.installed
                    ? ` (${text("installed", "Installed")})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {!releases.length && (
            <p>
              {text(
                "empty",
                "No compatible Windows setup releases on this page.",
              )}
            </p>
          )}
          {page.nextPage && (
            <button
              className="btn btn-secondary"
              disabled={busy || state.phase !== "idle"}
              onClick={() => void load(page.nextPage!)}
            >
              {text("more", "Load more releases")}
            </button>
          )}
          <p>
            {text(
              "warning",
              "Choosing an older version can cause compatibility problems with existing settings and sessions. This changes only the desktop app; it does not roll back the backend or your data. Back up important data before downgrading.",
            )}
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || state.phase !== "idle"}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {text("consent", "I understand the downgrade risks.")}
          </label>
          <div className="settings-card-actions">
            <button
              className="btn btn-secondary"
              disabled={!tag || busy || state.phase !== "idle"}
              onClick={() =>
                void act(() =>
                  window.hermesAPI.downloadDesktopRelease(tag, consent),
                )
              }
            >
              {busy
                ? text("working", "Working…")
                : text("download", "Download selected version")}
            </button>
          </div>
        </>
      )}
      {state.phase !== "idle" && (
        <p role="status">
          {state.phase === "ready"
            ? text("ready", "Selected installer ready")
            : text("downloading", "Downloading selected version")}
          : {state.version}
        </p>
      )}
      {state.phase === "ready" && (
        <div className="settings-card-actions">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void act(() =>
                window.hermesAPI.installDesktopRelease(state.version!),
              )
            }
          >
            {text("install", "Restart and install selected version")}
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() =>
              void act(() => window.hermesAPI.cancelDesktopRelease())
            }
          >
            {text("cancel", "Discard selected update")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
