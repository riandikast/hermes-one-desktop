import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

type Command = Awaited<ReturnType<typeof window.hermesAPI.listCommands>>[number];

export function TerminalCommandPicker({ onRun, onClose }: {
  onRun: (command: Command) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [commands, setCommands] = useState<Command[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI.listCommands().then((items) => {
      if (!cancelled) setCommands(items);
    }).catch(() => {
      if (!cancelled) setError("Failed to load command templates. Close and type @ to retry.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const matches = commands.filter((cmd) =>
    `${cmd.name} ${cmd.folder ?? ""} ${cmd.command}`.toLowerCase().includes(query.toLowerCase()));
  const run = async (cmd: Command): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setRunning(true);
    try {
      await onRun(cmd);
      onClose();
    } catch {
      toast.error("Failed to run command template.");
      lock.current = false;
      setRunning(false);
    }
  };
  return (
    <div
      ref={pickerRef}
      className="terminal-complete terminal-command-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !running) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        autoFocus
        aria-label="Search command templates"
        placeholder="@ Commands — select to run"
        value={query}
        disabled={running}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "@" && !running) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "Escape" && !running) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((previous) =>
              matches.length
                ? (previous + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length
                : 0
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (matches[index]) void run(matches[index]);
          }
        }}
      />
      <div role="listbox" aria-label="Command templates" aria-busy={loading || running}>
        {matches.map((cmd, i) => (
          <button
            type="button"
            role="option"
            key={cmd.id}
            aria-selected={i === index}
            disabled={running}
            className={`terminal-complete-item ${i === index ? "is-active" : ""}`}
            title={`${cmd.command}\nWorking directory: ${cmd.cwd || "default"}`}
            onClick={() => void run(cmd)}
          >
            <span className="terminal-command-title">{cmd.name}</span>
            <span className="terminal-command-meta">
              {cmd.folder ? `${cmd.folder} / ` : ""}
              {cmd.cwd || "default directory"}
            </span>
            <span className="terminal-command-preview">{cmd.command}</span>
          </button>
        ))}
      </div>
      <div className="terminal-complete-hint">
        {error || (loading ? "Loading commands…" : matches.length ? "Enter or click runs · Esc or @ dismisses" : "No command templates")}
      </div>
      <button type="button" className="terminal-complete-item" disabled={running} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
