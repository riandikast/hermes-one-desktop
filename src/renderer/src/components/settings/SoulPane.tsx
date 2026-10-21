import { useEffect, useState } from "react";
import { useI18n } from "../useI18n";
import "./SoulPane.css";

export default function SoulPane({
  profile,
  onDirtyChange,
}: {
  profile?: string;
  onDirtyChange: (dirty: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [target, setTarget] = useState<string>();
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const dirty = ready && content !== original;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setReady(false);
    setError("");
    setSaved(false);
    void (async () => {
      try {
        const connection = await window.hermesAPI.getConnectionConfig();
        // Existing Soul IPC falls back to local files in remote mode; SSH uses
        // guessed ~/.hermes paths. Neither is safe for this settings editor.
        if (connection.mode !== "local") throw new Error(t("soul.localOnly"));
        const selected =
          profile ||
          (await window.hermesAPI.listProfiles()).find((p) => p.isActive)?.id;
        if (!selected) throw new Error(t("soul.profileError"));
        const home = await window.hermesAPI.getHermesHome(selected);
        const text = await window.hermesAPI.readSoul(selected);
        if (cancelled) return;
        setTarget(selected);
        setPath(`${home.replace(/[\\/]$/, "")}/SOUL.md`);
        setContent(text);
        setOriginal(text);
        setReady(true);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, reload, t]);

  useEffect(() => {
    const preventClose = (event: BeforeUnloadEvent): void => {
      if (dirty || (busy && ready)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [dirty, busy, ready]);

  async function save(): Promise<void> {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      // Recheck immediately before writing: never write a local file after a
      // connection switch, even if the pane loaded in local mode.
      if ((await window.hermesAPI.getConnectionConfig()).mode !== "local")
        throw new Error(t("soul.localOnly"));
      if ((await window.hermesAPI.readSoul(target)) !== original)
        throw new Error(t("soul.conflict"));
      if (!(await window.hermesAPI.writeSoul(content, target)))
        throw new Error(t("soul.saveError"));
      if ((await window.hermesAPI.readSoul(target)) !== content)
        throw new Error(t("soul.verifyError"));
      setOriginal(content);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-modal-pane settings-soul-pane" aria-busy={busy}>
      <h2>{t("soul.settingsTitle")}</h2>
      <p className="settings-field-hint" id="settings-soul-hint">
        {t("soul.subtitle")}
      </p>
      {path && <p className="settings-field-hint settings-soul-path">{path}</p>}
      <label htmlFor="settings-soul-editor">SOUL.md</label>
      <textarea
        id="settings-soul-editor"
        className="soul-editor settings-soul-editor"
        aria-describedby="settings-soul-hint"
        disabled={!ready || busy}
        spellCheck={false}
        value={content}
        onChange={(event) => {
          // Textareas normalize CRLF; retain the existing file's line endings.
          setContent(
            original.includes("\r\n")
              ? event.target.value.replace(/\r?\n/g, "\r\n")
              : event.target.value,
          );
          setSaved(false);
        }}
      />
      <div className="settings-hermes-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm(t("soul.discardConfirm")))
              setReload((value) => value + 1);
          }}
        >
          {t("soul.reload")}
        </button>
        <span role="status">
          {busy
            ? t("soul.loading")
            : dirty
              ? t("soul.unsaved")
              : saved
                ? t("common.saved")
                : ""}
        </span>
      </div>
      {error && (
        <div role="alert" className="settings-hermes-result error">
          {error}
        </div>
      )}
    </div>
  );
}
