import { useState } from "react";
import { ChevronRight, ChevronDown, X } from "lucide-react";
import type { GitIgnoreResult } from "../../../../shared/git-ignore";

export function IgnoredFiles({ dir, refresh }: { dir: string; refresh: () => Promise<void> }): React.JSX.Element {
  const [data, setData] = useState<GitIgnoreResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const load = async (page = 0): Promise<void> => {
    setBusy(true); setError("");
    try {
      const result = await window.hermesAPI.gitIgnoreList(dir, page);
      if (!result.ok) throw new Error(result.error);
      setData(result); setOffset(page);
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  return <details className="source-control-section" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="source-control-section-title"><ChevronRight className="source-control-chevron-closed" size={14} aria-hidden="true" /><ChevronDown className="source-control-chevron-open" size={14} aria-hidden="true" />Ignored</summary>
    {busy && <p role="status">Loading ignored paths…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="source-control-section-toolbar"><button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>Refresh ignored</button></div>
    <h4 className="source-control-ignore-heading">Root .gitignore rules</h4>
    {data?.rules.length === 0 && <p className="source-control-empty">No root rules</p>}
    {data?.rules.map((rule) => <div className="source-control-file" key={rule.line}>
      <code className="source-control-file-name" title={rule.pattern}>{rule.pattern}</code>
      <button type="button" className="source-control-stage-btn" aria-label={`Remove ignore rule ${rule.pattern}`} disabled={busy} title={`Remove rule ${rule.pattern} from root .gitignore`} onClick={() => {
        if (!window.confirm(`Remove .gitignore rule “${rule.pattern}”? All paths matching this rule may become visible. Other ignore sources remain.`)) return;
        setBusy(true);
        void (async () => {
          try {
            const result = await window.hermesAPI.gitIgnoreRemove(dir, rule.line, rule.pattern, data.version);
            if (!result.ok) throw new Error(result.error);
            await refresh(); await load();
          } catch (err) { setError(String(err)); }
          finally { setBusy(false); }
        })();
      }}><X size={14} aria-hidden="true" /></button>
    </div>)}
    <h4 className="source-control-ignore-heading">Ignored files / collapsed directories</h4>
    {data?.files.length === 0 && <p className="source-control-empty">No ignored paths</p>}
    {data?.files.map((path) => <div className="source-control-file" key={path}><code className="source-control-file-name" title={path}>{path}</code></div>)}
    <div className="source-control-section-toolbar"><button type="button" className="btn-ghost btn-sm" disabled={busy || offset === 0} onClick={() => void load(offset - 100)}>Previous</button>
    <button type="button" className="btn-ghost btn-sm" disabled={busy || !data?.hasMore} onClick={() => void load(offset + 100)}>Next 100</button></div>
  </details>;
}
