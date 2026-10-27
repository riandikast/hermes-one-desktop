import { useEffect, useState } from "react";
import { format } from "date-fns";

export function MentionModifiedTime({
  path,
}: {
  path: string;
}): React.JSX.Element | null {
  const [modifiedAt, setModifiedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setModifiedAt(null);
    if (path && window.hermesAPI?.getPathModifiedTime) {
      void window.hermesAPI
        .getPathModifiedTime(path)
        .then((value) => {
          if (active && value !== null && Number.isFinite(value))
            setModifiedAt(value);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [path]);

  if (modifiedAt === null) return null;
  const date = new Date(modifiedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <time className="mention-modified-time" dateTime={date.toISOString()}>
      {format(date, "HH:mm, dd MMM yyyy")}
    </time>
  );
}
