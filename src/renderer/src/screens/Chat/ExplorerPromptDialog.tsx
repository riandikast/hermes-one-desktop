import { useEffect, useRef, useState } from "react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";

export interface ExplorerPromptRequest {
  kind: "rename" | "file" | "folder";
  /** Existing entry being renamed (unused for creation). */
  initial: string;
  /** Folder the new entry will be created in. */
  parent: string;
}

/** Themed single-field prompt; Electron's native prompt cannot be used here. */
export function ExplorerPromptDialog({
  request,
  onSubmit,
  onClose,
}: {
  request: ExplorerPromptRequest;
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(request.initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title =
    request.kind === "rename"
      ? "Rename"
      : request.kind === "file"
        ? "New File"
        : "New Folder";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const failure = await onSubmit(name.trim());
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="explorer-name-dialog"
    >
      <form onSubmit={(event) => void submit(event)}>
        <AppModalTitle className="explorer-name-title">{title}</AppModalTitle>
        <div className="explorer-name-parent" title={request.parent}>
          {request.parent}
        </div>
        <input
          ref={inputRef}
          className="explorer-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          aria-label={title}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {error && (
          <div className="explorer-name-error" role="alert">
            {error}
          </div>
        )}
        <div className="explorer-name-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !name.trim()}
          >
            {request.kind === "rename" ? "Rename" : "Create"}
          </button>
        </div>
      </form>
    </AppModal>
  );
}
