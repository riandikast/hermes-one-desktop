import { useEffect, useRef, useState } from "react";
import { FileText, Folder, Search, X } from "lucide-react";
import { searchFiles, type FileSearchEntry } from "../screens/Chat/fileSearch";

/**
 * VS Code-style search input, always visible on the title-bar row (right side,
 * next to the window controls).
 *
 * - Ctrl+F          → focus in "Files" mode (file-name search)
 * - Ctrl+Shift+F    → focus in "Content" mode (search inside files)
 * - Auto-targets the ACTIVE tab's context folders: seeded from the active run
 *   and kept live via the hermes-session-context-folder-changed event
 *   (scoped by session id — a background tab's folder change can't hijack it).
 * - Results: click, or navigate with ↑/↓ + Enter. Opens files through the
 *   existing hermes-open-file event (Layout opens a file tab; line-aware
 *   payload for content matches).
 */
type SearchMode = "files" | "content";

interface ContentMatchRow {
  path: string;
  line: number;
  text: string;
}

type Results = FileSearchEntry[] | ContentMatchRow[] | null;

export function SearchBar({
  initialFolders,
  sessionId,
}: {
  /** Folders of the active tab at mount (active run's context folders). */
  initialFolders: string[];
  /** Active run's gateway session id — scopes live folder updates. */
  sessionId: string | null;
}): React.JSX.Element {
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values for the (once-bound) keyboard handlers.
  const stateRef = useRef({ mode, query, results, activeIndex });
  stateRef.current = { mode, query, results, activeIndex };

  // Re-seed when the active tab changes (Layout re-renders with the new run).
  useEffect(() => {
    setFolders(initialFolders);
    setResults(null);
    setActiveIndex(-1);
  }, [initialFolders]);

  // Live folder tracking: Chat dispatches hermes-session-context-folder-changed
  // with { sessionId, folders } whenever the active session's folders change.
  useEffect(() => {
    const onFoldersChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: string; folders?: string[] }>)
        .detail;
      if (!detail || !sessionId || detail.sessionId !== sessionId) return;
      if (detail.folders) setFolders(detail.folders);
    };
    window.addEventListener("hermes-session-context-folder-changed", onFoldersChanged);
    return () =>
      window.removeEventListener("hermes-session-context-folder-changed", onFoldersChanged);
  }, [sessionId]);

  const openResultAt = (index: number): void => {
    const { mode: currentMode, results: currentResults } = stateRef.current;
    if (!currentResults || index < 0 || index >= currentResults.length) return;
    if (currentMode === "files") {
      const entry = currentResults[index] as FileSearchEntry;
      window.dispatchEvent(new CustomEvent("hermes-open-file", { detail: entry.path }));
    } else {
      const row = currentResults[index] as ContentMatchRow;
      window.dispatchEvent(
        new CustomEvent("hermes-open-file", {
          detail: { path: row.path, line: row.line },
        }),
      );
    }
  };

  // Global keyboard: Ctrl+F / Ctrl+Shift+F focus+mode, ↑/↓/Enter navigate the
  // results dropdown, Esc closes results then clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { results: currentResults, activeIndex: currentIndex } =
        stateRef.current;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setMode(e.shiftKey ? "content" : "files");
        setResults(null);
        inputRef.current?.focus();
        return;
      }

      if (e.key === "Escape") {
        if (currentResults) {
          setResults(null);
          setActiveIndex(-1);
        } else {
          setQuery("");
        }
        return;
      }

      if (!currentResults || currentResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % currentResults.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? currentResults.length - 1 : prev - 1,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = currentIndex >= 0 ? currentIndex : 0;
        openResultAt(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const seq = ++seqRef.current;
    if (!trimmed || folders.length === 0) {
      setResults(null);
      setSearching(false);
      setActiveIndex(-1);
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
          setActiveIndex(-1);
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
            setActiveIndex(-1);
          })
          .catch(() => {
            if (seqRef.current !== seq) return;
            setResults([]);
            setSearching(false);
            setActiveIndex(-1);
          });
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mode, query, folders]);

  const canSearch = folders.length > 0;
  const count = results?.length ?? 0;

  const toggleMode = (): void => {
    setMode((prev) => (prev === "files" ? "content" : "files"));
    setResults(null);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      className="search-bar-wrap"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="search-bar">
        <Search size={13} className="search-bar-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            !canSearch
              ? "Open a folder to search"
              : mode === "files"
                ? "Search files…"
                : "Search inside files…"
          }
          spellCheck={false}
          aria-label={mode === "files" ? "Search files" : "Search inside files"}
        />
        <button
          type="button"
          className={`search-bar-mode${mode === "content" ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleMode();
          }}
          title={
            mode === "files"
              ? "Search inside files (Ctrl+Shift+F)"
              : "Search files (Ctrl+F)"
          }
        >
          {mode === "files" ? "Files" : "Search"}
        </button>
        {searching && <span className="search-bar-busy" aria-label="Searching" />}
        {query && (
          <button
            type="button"
            className="search-bar-clear"
            onClick={(e) => {
              e.stopPropagation();
              setQuery("");
              setResults(null);
              setActiveIndex(-1);
            }}
            title="Clear (Esc)"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {(searching || results !== null) && (
        <div className="search-bar-results" role="listbox">
          {searching ? (
            <div className="search-bar-status">Searching…</div>
          ) : count === 0 ? (
            <div className="search-bar-status">No results</div>
          ) : mode === "files" ? (
            (results as FileSearchEntry[]).map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`search-bar-result${
                  index === activeIndex ? " active" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResultAt(index)}
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
                role="option"
                aria-selected={index === activeIndex}
                className={`search-bar-result${
                  index === activeIndex ? " active" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => openResultAt(index)}
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
