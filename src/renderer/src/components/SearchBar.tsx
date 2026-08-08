import { useEffect, useRef, useState } from "react";
import { FileText, Folder, Search, X } from "lucide-react";
import { searchFiles, type FileSearchEntry } from "../screens/Chat/fileSearch";

/**
 * VS Code-style FILE search input, always visible on the title-bar row (left
 * side). Ctrl+F focuses it. Ctrl+Shift+F is handled by Layout, which opens the
 * Find-in-Files dialog (content search) — see Layout.tsx.
 *
 * - Auto-targets the ACTIVE tab's context folders: seeded from the active run
 *   and kept live via the hermes-session-context-folder-changed event
 *   (scoped by session id — a background tab's folder change can't hijack it).
 * - Results: click, or navigate with ↑/↓ + Enter; the dropdown closes after a
 *   file is picked. Opens files through the existing hermes-open-file event.
 */
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileSearchEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed when the active tab's folder list CONTENT changes — not on array
  // identity. Layout passes `initialContextFolders ?? []`, which mints a fresh
  // [] on every render for folderless runs; keying on identity would wipe
  // results on every Layout re-render ("search works once, never again").
  const foldersKey = initialFolders.join("\u0000");
  const lastFoldersKeyRef = useRef<string | null>(null);
  if (lastFoldersKeyRef.current !== foldersKey) {
    lastFoldersKeyRef.current = foldersKey;
    setFolders(initialFolders);
    setResults(null);
    setActiveIndex(-1);
  }

  // Latest values for the (once-bound) keyboard handlers.
  const stateRef = useRef({ query, results, activeIndex });
  stateRef.current = { query, results, activeIndex };

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

  const closeResults = (): void => {
    setResults(null);
    setActiveIndex(-1);
  };

  const openResultAt = (index: number): void => {
    const { results: currentResults } = stateRef.current;
    if (!currentResults || index < 0 || index >= currentResults.length) return;
    const entry = currentResults[index] as FileSearchEntry;
    window.dispatchEvent(new CustomEvent("hermes-open-file", { detail: entry.path }));
    // Drop the dropdown once a file is picked.
    closeResults();
  };

  // Global keyboard: Ctrl+F focuses the input; ↑/↓/Enter navigate the results
  // dropdown; Esc closes results then clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        // Ctrl+Shift+F = content search → Layout opens the Find-in-Files dialog.
        if (e.shiftKey) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      const { results: currentResults, activeIndex: currentIndex } =
        stateRef.current;

      if (e.key === "Escape") {
        if (currentResults) {
          closeResults();
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
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, folders]);

  const canSearch = folders.length > 0;
  const count = results?.length ?? 0;

  return (
    <div className="search-bar-wrap" onClick={() => inputRef.current?.focus()}>
      <div className="search-bar">
        <Search size={13} className="search-bar-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            !canSearch ? "Open a folder to search" : "Search files…"
          }
          spellCheck={false}
          aria-label="Search files"
        />
        {searching && <span className="search-bar-busy" aria-label="Searching" />}
        {query && (
          <button
            type="button"
            className="search-bar-clear"
            onClick={(e) => {
              e.stopPropagation();
              setQuery("");
              closeResults();
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
          ) : (
            (results ?? []).map((entry, index) => (
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
          )}
        </div>
      )}
    </div>
  );
}
