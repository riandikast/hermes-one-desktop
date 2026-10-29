import { useEffect, useState } from "react";
import { GitPullRequest } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { SourceControlDialog } from "./SourceControlDialog";

export function SourceControlShortcut({
  baseFolder,
  available,
}: {
  baseFolder: string | undefined;
  available: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!baseFolder || !available) setOpen(false);
  }, [baseFolder, available]);

  return (
    <>
      <button
        type="button"
        className="btn-ghost chat-source-control"
        disabled={!baseFolder || !available}
        onClick={() => setOpen(true)}
        aria-label={t("chat.sourceControl.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={!baseFolder ? t("chat.sourceControl.chooseFolder") : !available ? t("chat.sourceControl.remoteUnavailable") : `${t("chat.sourceControl.title")}: ${baseFolder}`}
      >
        <GitPullRequest size={15} />
      </button>
      {open && baseFolder && available && (
        <SourceControlDialog key={baseFolder} dir={baseFolder} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
