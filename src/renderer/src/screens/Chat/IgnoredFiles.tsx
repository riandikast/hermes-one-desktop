import { useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import type { GitIgnoreResult } from "../../../../shared/git-ignore";

export function IgnoredFiles({ dir, refresh }: { dir: string; refresh: () => Promise<void> }): React.JSX.Element {
  const [data, setData] = useState<GitIgnoreResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const load = async (page = offset): Promise<void> => {
    setBusy(true); setError("");
    try {
      const result = await window.hermesAPI.gitIgnoreList(dir, page);
      if (!result.ok) throw new Error(result.error);
      setData(result);
      setOffset(page);
      setSelected((current) => current.filter((path) => result.files.includes(path)));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data?.files.filter((path) => !needle || path.toLowerCase().includes(needle)) ?? [];
  }, [data, query]);
  const selectPath = (path: string, shift: boolean): void => {
    const anchorIndex = shift && selectionAnchor.current ? filteredFiles.indexOf(selectionAnchor.current) : -1;
    const pathIndex = filteredFiles.indexOf(path);
    setSelected((current) => {
      if (anchorIndex >= 0 && pathIndex >= 0) {
        const range = filteredFiles.slice(Math.min(anchorIndex, pathIndex), Math.max(anchorIndex, pathIndex) + 1);
        return [...current.filter((item) => !range.includes(item)), ...range];
      }
      return current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
    });
    if (!shift || anchorIndex < 0) selectionAnchor.current = path;
  };
  return <details className="source-control-section" onToggle={(event) => { if (event.currentTarget.open && !data) void load(); }}>
    <summary className="source-control-section-title"><ChevronRight className="source-control-chevron-closed" size={14} aria-hidden="true" /><ChevronDown className="source-control-chevron-open" size={14} aria-hidden="true" />Ignored</summary>
    {busy && <p className="source-control-loading-state" role="status"><LoaderCircle size={15} aria-hidden="true" />Loading ignored paths…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="source-control-ignore-tools">
      <label className="source-control-ignore-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ignored" aria-label="Search ignored paths" /></label>
      <button type="button" className="btn-ghost btn-sm" aria-label="Refresh ignored" title="Refresh ignored" disabled={busy} onClick={() => void load()}><RefreshCw size={14} /></button>
    </div>
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
    {data && filteredFiles.length === 0 && <p className="source-control-empty">{query ? "No ignored paths match" : "No ignored paths"}</p>}
    {filteredFiles.map((path) => <div className={`source-control-file${selected.includes(path) ? " selected" : ""}`} key={path}>
      <input type="checkbox" className="source-control-file-select" aria-label={`Select ignored ${path}`} checked={selected.includes(path)} disabled={busy} onChange={(event) => selectPath(path, (event.nativeEvent as MouseEvent).shiftKey)} />
      <code className="source-control-file-name" title={path}>{path}</code>
    </div>)}
    <div className="source-control-ignore-tools">
      <button type="button" className="btn-ghost btn-sm" disabled={busy || offset === 0} onClick={() => void load(offset - 100)}>Previous</button>
      <button type="button" className="btn-ghost btn-sm" disabled={busy || !data?.hasMore} onClick={() => void load(offset + 100)}>Next 100</button>
    </div>
  </details>;
}
