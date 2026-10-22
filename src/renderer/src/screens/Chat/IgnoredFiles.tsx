import { useState } from "react";
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
    <summary className="source-control-section-title">Ignored</summary>
    <p className="source-control-empty">Root .gitignore rules. Removing a rule never deletes files. Broad rules affect every matching path. Nested .gitignore, .git/info/exclude and global rules remain in effect.</p>
    {busy && <p role="status">Loading ignored paths…</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void load()}>Refresh ignored</button>
    <h4>Root .gitignore rules</h4>
    {data?.rules.length === 0 && <p>No root rules</p>}
    {data?.rules.map((rule) => <div className="source-control-file" key={rule.line}>
      <code className="source-control-file-name" title={rule.pattern}>{rule.pattern}</code>
      <button type="button" disabled={busy} title={`Remove rule ${rule.pattern} from root .gitignore`} onClick={() => {
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
      }}>Remove from ignore</button>
    </div>)}
    <h4>Ignored files / collapsed directories</h4>
    {data?.files.length === 0 && <p>No ignored paths</p>}
    {data?.files.map((path) => <div className="source-control-file" key={path}><code className="source-control-file-name" title={path}>{path}</code></div>)}
    <button type="button" disabled={busy || offset === 0} onClick={() => void load(offset - 100)}>Previous</button>
    <button type="button" disabled={busy || !data?.hasMore} onClick={() => void load(offset + 100)}>Next 100</button>
  </details>;
}
