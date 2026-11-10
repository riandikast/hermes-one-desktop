import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { useI18n } from "../useI18n";

export default function SettingsHint({
  children,
  id,
  label,
}: {
  children: ReactNode;
  id?: string;
  label?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <details className="settings-hint">
      <summary className="settings-hint-trigger" aria-label={label ?? t("settings.moreInformation", { defaultValue: "More information" })}>
        <CircleHelp size={14} aria-hidden="true" />
      </summary>
      <div className="settings-hint-content" id={id}>{children}</div>
    </details>
  );
}
