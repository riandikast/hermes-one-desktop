import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
} from "lucide-react";

export interface FindInFilesResult {
  path: string;
  matches: { line: number; text: string }[];
}

interface FindInFilesDialogProps {
  /** Workspace roots to search (the chat's context folders). */
  folders: string[];
  onClose: () => void;
  /** Open a file, optionally at a specific 1-based line. */
  onOpenFile: (path: string, line?: number) => void;
}

const DEBOUNCE_MS = 250;

/** Highlight every case-insensitive occurrence of the query in the snippet. */
function HighlightedSnippet({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.JSX.Element {
  const needle = query.toLowerCase();
  if (!needle) {
    return <>{text}</>;
  }
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor)
      parts.push(<span key={key++}>{text.slice(cursor, idx)}</span>);
    parts.push(
      <mark key={key++} className="find-in-files-mark">
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    cursor = idx + query.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length)
    parts.push(<span key={key++}>{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

/** Full-screen "Find in Files" dialog (Android-Studio Ctrl+Shift+F style):
 *  searches file CONTENTS across the workspace roots, grouped per file with
 *  matching line snippets. */
export function FindInFilesDialog({
  folders,
  onClose,
  onOpenFile,
}: FindInFilesDialogProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FindInFilesResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  // Autofocus the input (the dialog mounts on a click — plain autoFocus works).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    (needle: string) => {
      const seq = ++searchSeqRef.current;
      setSearching(true);
      setError(null);
      void window.hermesAPI
        .searchInFiles(folders, needle)
        .then((res) => {
          if (searchSeqRef.current !== seq) return;
          setResults(res ?? []);
          setSearching(false);
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return;
          setError("Search failed");
          setResults(null);
          setSearching(false);
        });
    },
    [folders],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const needle = query.trim();
    if (!needle) {
      setResults(null);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(needle), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const toggleFile = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const matchCount =
    results?.reduce((sum, r) => sum + r.matches.length, 0) ?? 0;

  return (
    <div className="file-changes-overlay" onClick={onClose}>
      <div
        className="find-in-files-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Find in Files"
      >
        <div className="find-in-files-header">
          <span className="find-in-files-title">
            <Search size={15} />
            Find in Files
            <span className="find-in-files-scope">
              {folders.length} {folders.length === 1 ? "folder" : "folders"}
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="find-in-files-input-row">
          <input
            ref={inputRef}
            type="text"
            className="find-in-files-input"
            placeholder="Search string in files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (debounceRef.current) clearTimeout(debounceRef.current);
                const needle = query.trim();
                if (needle) runSearch(needle);
              }
            }}
          />
          {searching && <Loader2 size={15} className="find-in-files-spinner" />}
        </div>

        <div className="find-in-files-body">
          {error ? (
            <div className="find-in-files-empty">{error}</div>
          ) : !query.trim() ? (
            <div className="find-in-files-empty">
              Type a string to search across the workspace folders.
            </div>
          ) : results === null ? (
            <div className="find-in-files-empty">
              {searching ? "Searching…" : "No results"}
            </div>
          ) : results.length === 0 ? (
            <div className="find-in-files-empty">
              No files contain “{query.trim()}”.
            </div>
          ) : (
            <>
              <div className="find-in-files-summary">
                {results.length} {results.length === 1 ? "file" : "files"} ·{" "}
                {matchCount} {matchCount === 1 ? "match" : "matches"}
              </div>
              {results.map((file) => {
                const isOpen = expanded.has(file.path);
                const fileName =
                  file.path.split(/[\\/]/).filter(Boolean).pop() || file.path;
                return (
                  <div key={file.path} className="find-in-files-file">
                    <button
                      type="button"
                      className="find-in-files-file-header"
                      onClick={() => toggleFile(file.path)}
                      title={file.path}
                    >
                      {isOpen ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                      <FileText size={13} />
                      <span className="find-in-files-file-name">
                        {fileName}
                      </span>
                      <span className="find-in-files-file-count">
                        {file.matches.length}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="find-in-files-matches">
                        {file.matches.map((m) => (
                          <button
                            key={m.line}
                            type="button"
                            className="find-in-files-match"
                            onClick={() => onOpenFile(file.path, m.line)}
                            title={`${file.path}:${m.line}`}
                          >
                            <span className="find-in-files-line-no">
                              {m.line}
                            </span>
                            <span className="find-in-files-line-text">
                              <HighlightedSnippet
                                text={m.text}
                                query={query.trim()}
                              />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
