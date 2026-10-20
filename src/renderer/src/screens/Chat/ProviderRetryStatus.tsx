import { memo, useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { ProviderRetry } from "./providerRetry";

export const ProviderRetryStatus = memo(function ProviderRetryStatus({ wait, onSwitch, canSwitch }: {
  wait: ProviderRetry | null;
  onSwitch: () => Promise<void>;
  canSwitch: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    setUnconfirmed(false);
    if (wait?.deadline == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [wait]);
  if (!wait) return null;
  const seconds = wait.deadline === null ? null : Math.max(0, Math.ceil((wait.deadline - now) / 1000));
  return <div className="chat-provider-retry">
    <span role="status">{unconfirmed ? t("chat.providerRetry.unconfirmed") : seconds === null
      ? t("chat.providerRetry.silent") : seconds > 0
        ? t("chat.providerRetry.countdown", { seconds }) : t("chat.providerRetry.due")}
      {wait.attempt ? ` (${wait.attempt})` : ""}</span>
    {canSwitch && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await onSwitch(); setUnconfirmed(true); } finally { setBusy(false); }
    }}>{t(busy ? "chat.providerRetry.stopping" : "chat.providerRetry.switch")}</button>}
  </div>;
});
