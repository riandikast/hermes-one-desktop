import { useEffect, useId, useState } from "react";
import { useI18n } from "../../components/useI18n";

/** Native profile settings, not a second renderer-triggered compaction loop. */
export function ContextCompressionSettings({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const id = useId();
  const [enabled, setEnabled] = useState(true);
  const [ceiling, setCeiling] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      window.hermesAPI.getConfig("compression.enabled", profile),
      window.hermesAPI.getConfig("compression.threshold_tokens", profile),
    ]).then(([active, cap]) => {
      if (cancelled) return;
      setEnabled(active !== "false");
      const tokens = Number(cap);
      setCeiling(Number.isSafeInteger(tokens) && tokens > 0 ? String(tokens) : "");
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [profile]);

  const tokens = Number(ceiling);
  const valid = ceiling === "" || (Number.isSafeInteger(tokens) && tokens > 0);
  const save = async (): Promise<void> => {
    if (!valid || status === "saving") return;
    setStatus("saving");
    try {
      const cap = ceiling === "" ? "null" : String(tokens);
      if (!await window.hermesAPI.setConfig("compression.threshold_tokens", cap, profile)) throw new Error("write failed");
      if (!await window.hermesAPI.setConfig("compression.enabled", String(enabled), profile)) throw new Error("write failed");
      const [savedCap, savedEnabled] = await Promise.all([
        window.hermesAPI.getConfig("compression.threshold_tokens", profile),
        window.hermesAPI.getConfig("compression.enabled", profile),
      ]);
      if ((cap === "null" ? savedCap != null && savedCap !== "null" : Number(savedCap) !== tokens) || savedEnabled !== String(enabled)) throw new Error("verification failed");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  if (status === "loading") return <div role="status">{t("chat.contextCompressionLoading")}</div>;
  if (status === "error") return <div role="alert">{t("chat.contextCompressionFailed")}</div>;
  return (
    <form className="chat-ctx-settings" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="chat-ctx-enable">
        <input type="checkbox" checked={enabled} disabled={status === "saving"} onChange={(e) => { setEnabled(e.target.checked); setStatus("ready"); }} />
        {t("chat.contextAutoCompact")}
      </label>
      <label htmlFor={id}>{t("chat.contextCompactCeiling")}</label>
      <input id={id} className="input" type="number" min={1} step={1} value={ceiling} placeholder={t("chat.contextCompactAutomatic")} disabled={status === "saving"} aria-describedby={`${id}-hint`} onChange={(e) => { setCeiling(e.target.value); setStatus("ready"); }} />
      <p id={`${id}-hint`} className="chat-ctx-hint">{t("chat.contextCompressionHint")}</p>
      <button type="submit" className="btn btn-secondary btn-xs" disabled={!valid || status === "saving"}>{t("common.save")}</button>
      {status === "saved" && <div role="status">{t("chat.contextCompressionSaved")}</div>}
    </form>
  );
}
