import { useState } from "react";
import {
  AppModal,
  AppModalTitle,
  AppModalDescription,
} from "../../components/modal/AppModal";
import type {
  KnowledgePackagePreview,
  KnowledgeSource,
  KnowledgeSourceSettings,
} from "../../../../shared/knowledge-package";
import "./KnowledgePackages.css";

export function KnowledgePackages({
  settings,
  onImported,
  onLocated,
  beforeExport,
}: {
  settings: KnowledgeSourceSettings;
  onImported: (settings: KnowledgeSourceSettings) => Promise<void>;
  onLocated: (id: string, root: string) => Promise<void>;
  beforeExport: () => Promise<void>;
}): React.JSX.Element {
  const [preview, setPreview] = useState<KnowledgePackagePreview | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [roots, setRoots] = useState<Record<string, string | null>>({});
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Knowledge package operation failed",
      );
    } finally {
      setBusy(false);
    }
  };
  const open = (): void => {
    void run(async () => {
      const result = await window.hermesAPI.previewKnowledgePackage();
      if (!result) return;
      setPreview(result);
      setNames(
        Object.fromEntries(
          result.bundles.map((b) => [
            b.name,
            b.conflict ? `${b.name}-imported` : b.name,
          ]),
        ),
      );
      setRoots({});
    });
  };
  const locate = async (id: string): Promise<void> => {
    await beforeExport();
    const root = await window.hermesAPI.selectFolder();
    if (!root) return;
    const settings = await window.hermesAPI.locateKnowledgeSource(id, root);
    await onImported(settings);
    await onLocated(id, root);
    setSources(await window.hermesAPI.listKnowledgeSources());
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={open}
      >
        Import Package
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await beforeExport();
            const path =
              await window.hermesAPI.exportKnowledgePackage(settings);
            if (path) setNotice(`Package exported: ${path}`);
          })
        }
      >
        Export Package
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setSources(await window.hermesAPI.listKnowledgeSources());
          })
        }
      >
        Portable Sources
      </button>
      {!preview && !sources && error && (
        <span role="alert" className="knowledge-package-message">
          {error}
        </span>
      )}
      {!preview && !sources && notice && (
        <span role="status" className="knowledge-package-message">
          {notice}
        </span>
      )}
      <AppModal
        open={preview !== null || sources !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPreview(null);
            setSources(null);
          }
        }}
        className="knowledge-package-dialog"
      >
        <AppModalTitle>
          {preview ? "Import Knowledge Package" : "Portable Sources"}
        </AppModalTitle>
        <AppModalDescription>
          {preview
            ? "Review bundle names and map external folders. Existing bundles are never overwritten. External file contents are not included."
            : "Folder mappings stay on this device. Unresolved references remain visible until you locate their source."}
        </AppModalDescription>
        <div className="knowledge-package-body">
          {preview && (
            <>
              <h4>Bundles</h4>
              {preview.bundles.map((bundle) => (
                <label key={bundle.name} className="knowledge-package-row">
                  <span>
                    {bundle.name} ({bundle.files} files)
                    {bundle.conflict ? ", name already exists" : ""}
                  </span>
                  <input
                    className="input"
                    aria-label={`Import name for ${bundle.name}`}
                    disabled={busy}
                    value={names[bundle.name] || ""}
                    onChange={(e) =>
                      setNames({ ...names, [bundle.name]: e.target.value })
                    }
                  />
                </label>
              ))}
              <h4>External folders</h4>
              {preview.sources.length === 0 && <p>No external sources.</p>}
              {preview.sources.map((source) => (
                <div key={source.id} className="knowledge-package-row">
                  <span>{source.name}</span>
                  <span className="knowledge-package-path">
                    {roots[source.id] || "Unresolved (locate later)"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const root = await window.hermesAPI.selectFolder();
                        if (root)
                          setRoots((prev) => ({ ...prev, [source.id]: root }));
                      })
                    }
                  >
                    Locate folder for {source.name}
                  </button>
                </div>
              ))}
            </>
          )}
          {sources && sources.length === 0 && (
            <p>
              No portable sources yet. Insert a file using @, then save the
              knowledge file.
            </p>
          )}
          {sources?.map((source) => (
            <div key={source.id} className="knowledge-package-row">
              <span>{source.name}</span>
              <span className="knowledge-package-path">
                {source.root || "Unresolved"}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void run(() => locate(source.id))}
              >
                Locate folder for {source.name}
              </button>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Working…</p>}
        </div>
        <div className="knowledge-package-footer">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setSources(null);
            }}
          >
            Cancel
          </button>
          {preview && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy || Object.values(names).some((name) => !name.trim())
              }
              onClick={() =>
                void run(async () => {
                  const result = await window.hermesAPI.importKnowledgePackage({
                    ticket: preview.ticket,
                    names,
                    roots,
                  });
                  await onImported(result.settings);
                  setPreview(null);
                  setNotice(`Imported ${result.bundles.length} bundle(s).`);
                })
              }
            >
              Import bundles
            </button>
          )}
        </div>
      </AppModal>
    </>
  );
}
