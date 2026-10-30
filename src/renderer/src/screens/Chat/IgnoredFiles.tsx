import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, LoaderCircle, RefreshCw, Search, X, ArrowDownAZ, CalendarArrowDown } from "lucide-react";
import type { GitIgnoreResult } from "../../../../shared/git-ignore";

export function IgnoredFiles({ dir, refresh }: { dir: string; refresh: () => Promise<void> }): React.JSX.Element {
  const [data, setData] = useState<GitIgnoreResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "date">("name");
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const ruleAnchor = useRef<string | null>(null);
  const request = useRef(0);
  const load = async (): Promise<void> => {
    const id = ++request.current;
    setBusy(true); setError("");
    try {
      const result = await window.hermesAPI.gitIgnoreList(dir, 0, query, sort);
      if (id !== request.current) return;
      if (!result.ok) throw new Error(result.error);
      setData(result);
      setSelected([]);
      selectionAnchor.current = null;
      ruleAnchor.current = null;
    } catch (err) { if (id === request.current) setError(String(err)); }
    finally { if (id === request.current) setBusy(false); }
  };
  useEffect(() => {
    if (!opened) return;
    // Search the collapsed status before its 100-result cap, never stale pages.
    ++request.current;
    setData(null); setSelected([]);
    selectionAnchor.current = null;
    ruleAnchor.current = null;
    const timer = window.setTimeout(() => void load(), 200);
    return () => { window.clearTimeout(timer); ++request.current; };
  }, [dir, query, opened, sort]);
  const filteredRules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rules.filter((rule) => !needle || rule.pattern.toLowerCase().includes(needle)) ?? []).sort((a, b) => sort === "name" ? a.pattern.localeCompare(b.pattern) || a.line - b.line : b.line - a.line);
  }, [data, query, sort]);
  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data?.files.filter((path) => !needle || path.toLowerCase().includes(needle)) ?? [];
  }, [data, query]);
  const selectRule = (ruleKey: string, shift: boolean): void => {
    const keys = filteredRules.map((rule) => `rule:${rule.line}`);
    const anchorIndex = shift && ruleAnchor.current ? keys.indexOf(ruleAnchor.current) : -1;
    const keyIndex = keys.indexOf(ruleKey);
    setSelected((current) => {
      if (anchorIndex >= 0 && keyIndex >= 0) {
        const range = keys.slice(Math.min(anchorIndex, keyIndex), Math.max(anchorIndex, keyIndex) + 1);
        return [...current.filter((item) => !range.includes(item)), ...range];
      }
      return current.includes(ruleKey) ? current.filter((item) => item !== ruleKey) : [...current, ruleKey];
    });
    if (!shift || anchorIndex < 0) ruleAnchor.current = ruleKey;
  };
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
  return <details className="source-control-section" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary className="source-control-section-title"><ChevronRight className="source-control-chevron-closed" size={14} aria-hidden="true" /><ChevronDown className="source-control-chevron-open" size={14} aria-hidden="true" />Ignored</summary>
    <div className="source-control-ignore-tools">
      <label className="source-control-ignore-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ignored" aria-label="Search ignored paths" /></label>
      <button type="button" className="btn-ghost btn-sm" aria-label={sort === "name" ? "Sort ignored by date" : "Sort ignored by name"} aria-pressed={sort === "date"} title={sort === "name" ? "Sort by newest modification; rules use reverse file order" : "Sort by name"} onClick={() => setSort((current) => current === "name" ? "date" : "name")}>
        {sort === "name" ? <ArrowDownAZ size={14} aria-hidden="true" /> : <CalendarArrowDown size={14} aria-hidden="true" />}
      </button>
      <button type="button" className="btn-ghost btn-sm" aria-label="Refresh ignored" title="Refresh ignored" disabled={busy} onClick={() => void load()}><RefreshCw size={14} /></button>
    </div>
    {busy && <p className="source-control-loading-state" role="status"><LoaderCircle size={15} aria-hidden="true" />Loading ignored paths…</p>}
    {error && <p role="alert">{error}</p>}
    <h4 className="source-control-ignore-heading">Root .gitignore rules</h4>
    {data?.rules.length === 0 && <p className="source-control-empty">No root rules</p>}
    {filteredRules.map((rule) => <div className={`source-control-file${selected.includes(`rule:${rule.line}`) ? " selected" : ""}`} key={rule.line}>
      <input type="checkbox" className="source-control-file-select" aria-label={`Select ignore rule ${rule.pattern}`} checked={selected.includes(`rule:${rule.line}`)} disabled={busy} onChange={(event) => selectRule(`rule:${rule.line}`, (event.nativeEvent as MouseEvent).shiftKey)} />
      <code className="source-control-file-name" title={rule.pattern}>{rule.pattern}</code>
      <button type="button" className="source-control-stage-btn" aria-label={`Remove ignore rule ${rule.pattern}`} disabled={busy} title={`Remove rule ${rule.pattern} from root .gitignore`} onClick={() => {
        if (!data || !window.confirm(`Remove .gitignore rule “${rule.pattern}”? All paths matching this rule may become visible. Other ignore sources remain.`)) return;
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
      <button type="button" className="source-control-stage-btn" aria-label={`Stop ignoring ${path}`} disabled={busy} title="Add a literal root .gitignore exception; never delete files" onClick={() => {
        if (!window.confirm(`Stop ignoring “${path}” by adding a root .gitignore exception? Directory contents may become visible. No disk files will be deleted. Nested, global and info/exclude rules cannot be changed here.`)) return;
        setBusy(true); setError("");
        void (async () => {
          try {
            const result = await window.hermesAPI.gitIgnoreUnignore(dir, path, data!.version);
            if (!result.ok) throw new Error(result.error);
            await refresh(); await load();
          } catch (err) { setError(String(err)); }
          finally { setBusy(false); }
        })();
      }}><X size={14} aria-hidden="true" /></button>
    </div>)}
    {data?.hasMore && <p className="source-control-empty">Showing up to 100 matching paths. Refine search to find others.</p>}
  </details>;
}
