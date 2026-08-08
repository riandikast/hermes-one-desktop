import { useEffect, useRef, useState } from "react";
import { FileText, Folder, Search, X } from "lucide-react";
import { searchFiles, type FileSearchEntry } from "../screens/Chat/fileSearch";

/**
 * VS Code-style search bar above the tab strip.
 *
 * - Ctrl+F          → open in "Files" mode (file-name search over the active
 *                     run's context folders — same pipeline as the worktree
 *                     panel: listFilesRecursive + Everything + fuzzy rank)
 * - Ctrl+Shift+F    → open in "Content" mode (search inside files via
 *                     searchInFiles, same backend as Find-in-Files)
 * - Esc closes; results open files through the existing hermes-open-file
 *   event (Layout opens a file tab; line-aware payload for content matches).
 */
type SearchMode = "files" | "content";

interface ContentMatchRow {
  path: string;
  line: number;
  text: string;
}

type Results = FileSearchEntry[] | ContentMatchRow[] | null;

export function SearchBar({ folders }: { folders: string[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSearch = (nextMode: SearchMode): void => {
    setMode(nextMode);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Global keybinds: Ctrl+F → files, Ctrl+Shift+F → content. preventDefault
  // also suppresses the Chromium find bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch(e.shiftKey ? "content" : "files");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Esc closes and clears.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setResults(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    const seq = ++seqRef.current;
    if (!trimmed || folders.length === 0) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (mode === "files") {
        void (async () => {
          const seen = new Set<string>();
          const all: FileSearchEntry[] = [];
          for (const folder of folders) {
            const list = await window.hermesAPI.listFilesRecursive(folder);
            if (seqRef.current !== seq || !list) continue;
            for (const entry of list) {
              if (!entry.path || seen.has(entry.path)) continue;
              seen.add(entry.path);
              all.push(entry);
            }
            try {
              const ev = await window.hermesAPI.everythingSearch(trimmed, folder);
              if (seqRef.current !== seq || !ev) continue;
              for (const entry of ev) {
                if (!entry.path || seen.has(entry.path)) continue;
                seen.add(entry.path);
                all.push(entry);
              }
            } catch {
              /* Everything search unavailable */
            }
          }
          if (seqRef.current !== seq) return;
          setResults(searchFiles(all, trimmed, "all").slice(0, 15));
          setSearching(false);
        })();
      } else {
        void window.hermesAPI
          .searchInFiles(folders, trimmed)
          .then((res) => {
            if (seqRef.current !== seq) return;
            const rows: ContentMatchRow[] = [];
            for (const file of res ?? []) {
              for (const match of file.matches) {
                rows.push({ path: file.path, line: match.line, text: match.text });
                if (rows.length >= 100) break;
              }
              if (rows.length >= 100) break;
            }
            setResults(rows);
            setSearching(false);
          })
          .catch(() => {
            if (seqRef.current !== seq) return;
            setResults([]);
            setSearching(false);
          });
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, mode, query, folders]);

  if (!open) return null;

  const canSearch = folders.length > 0;
  const count = results?.length ?? 0;

  const openFile = (path: string, line?: number): void => {
    window.dispatchEvent(
      new CustomEvent("hermes-open-file", {
        detail: line ? { path, line } : path,
      }),
    );
  };

  return (
    <div className="search-bar-wrap">
      <div className="search-bar">
        <div className="search-bar-modes">
          <button
            type="button"
            className={`search-bar-mode${mode === "files" ? " active" : ""}`}
            onClick={() => {
              setMode("files");
              setResults(null);
            }}
            title="Search files (Ctrl+F)"
          >
            Files
          </button>
          <button
            type="button"
            className={`search-bar-mode${mode === "content" ? " active" : ""}`}
            onClick={() => {
              setMode("content");
              setResults(null);
            }}
            title="Search inside files (Ctrl+Shift+F)"
          >
            Search
          </button>
        </div>
        <Search size={14} className="search-bar-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            !canSearch
              ? "Open a folder first — nothing to search"
              : mode === "files"
                ? "Search files…"
                : "Search inside files…"
          }
          disabled={!canSearch}
          spellCheck={false}
        />
        {searching && <span className="search-bar-busy" aria-label="Searching" />}
        {query && (
          <button
            type="button"
            className="search-bar-clear"
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
            title="Clear"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
        <button
          type="button"
          className="search-bar-close"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close search"
        >
          <X size={14} />
        </button>
      </div>
      {(searching || results !== null) && (
        <div className="search-bar-results">
          {searching ? (
            <div className="search-bar-status">Searching…</div>
          ) : count === 0 ? (
            <div className="search-bar-status">No results</div>
          ) : mode === "files" ? (
            (results as FileSearchEntry[]).map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="search-bar-result"
                onClick={() => openFile(entry.path)}
                title={entry.path}
              >
                {entry.isDirectory ? (
                  <Folder size={14} className="search-bar-result-icon" />
                ) : (
                  <FileText size={14} className="search-bar-result-icon" />
                )}
                <span className="search-bar-result-name">{entry.name}</span>
                <span className="search-bar-result-path">{entry.path}</span>
              </button>
            ))
          ) : (
            (results as ContentMatchRow[]).map((row, index) => (
              <button
                key={`${row.path}:${row.line}:${index}`}
                type="button"
                className="search-bar-result"
                onClick={() => openFile(row.path, row.line)}
                title={`${row.path}:${row.line}`}
              >
                <FileText size={14} className="search-bar-result-icon" />
                <span className="search-bar-result-name">{row.path}</span>
                <span className="search-bar-result-lineno">{row.line}</span>
                <span className="search-bar-result-text">{row.text}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
