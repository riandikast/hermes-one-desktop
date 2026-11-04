import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { FloatingDialog } from "./FloatingDialog";
import type {
  AndroidDevice,
  LogcatLine,
} from "../../../../shared/android-logcat";
import "./AndroidLogcat.css";

/** Local, opt-in device diagnostics. Closing or leaving the chat stops our ADB reader. */
export function AndroidLogcat({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [serial, setSerial] = useState("");
  const [lines, setLines] = useState<LogcatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("V");
  const [follow, setFollow] = useState(true);
  const alive = useRef(true);
  const capture = useRef<string | null>(null);
  const busy = useRef(false);
  const cursor = useRef(0);
  const output = useRef<HTMLDivElement>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await window.hermesAPI.listAndroidDevices();
      if (!alive.current) return;
      setDevices(result.devices);
      setError(result.error ?? null);
      setSerial((previous) =>
        result.devices.some(
          (d) => d.serial === previous && d.state === "device",
        )
          ? previous
          : (result.devices.find((d) => d.state === "device")?.serial ?? ""),
      );
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      if (capture.current)
        void window.hermesAPI
          .stopAndroidLogcat(capture.current)
          .catch(() => {});
      capture.current = null;
    };
  }, []);

  const stop = (): void => {
    const previous = capture.current;
    capture.current = null;
    setId(null);
    if (previous)
      void window.hermesAPI.stopAndroidLogcat(previous).catch((e) => {
        if (alive.current) setError(String(e));
      });
  };
  const start = async (): Promise<void> => {
    if (busy.current || !serial) return;
    busy.current = true;
    setStarting(true);
    setError(null);
    try {
      const result = await window.hermesAPI.startAndroidLogcat(serial);
      if (!alive.current) {
        if (result.ok) await window.hermesAPI.stopAndroidLogcat(result.id);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLines([]);
      cursor.current = 0;
      capture.current = result.id;
      setPaused(false);
      setId(result.id);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      busy.current = false;
      if (alive.current) setStarting(false);
    }
  };
  useEffect(() => {
    if (!id || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await window.hermesAPI.readAndroidLogcat(
          id,
          cursor.current,
        );
        if (cancelled || capture.current !== id) return;
        if (result.lines.length) {
          cursor.current = result.lines[result.lines.length - 1].seq;
          setLines((previous) => [...previous, ...result.lines].slice(-2000));
        }
        if (result.error) setError(result.error);
        if (!result.running) {
          stop();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        stop();
        return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, paused]);

  const visible = useMemo(() => {
    const minimum = "VDIWEFA".indexOf(priority);
    const text = query.toLowerCase();
    return lines
      .filter(
        (line) =>
          "VDIWEFA".indexOf(line.priority) >= minimum &&
          line.text.toLowerCase().includes(text),
      )
      .slice(-500);
  }, [lines, query, priority]);
  useEffect(() => {
    if (follow && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [visible, follow]);

  return (
    <FloatingDialog open title="Android Logcat" size="wide" onClose={onClose}>
      <section className="android-logcat" aria-label="Android device logs">
        <div className="android-logcat-toolbar">
          <select
            aria-label="Android device"
            value={serial}
            disabled={Boolean(id) || starting}
            onChange={(e) => setSerial(e.target.value)}
          >
            <option value="">Select device</option>
            {devices.map((device) => (
              <option
                key={device.serial}
                value={device.serial}
                disabled={device.state !== "device"}
              >
                {device.label} · {device.serial} ({device.state})
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="Refresh Android devices"
            title="Refresh devices"
            disabled={loading || Boolean(id)}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={14}
              className={loading ? "android-logcat-spin" : ""}
            />
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={starting || (!id && !serial)}
            onClick={() => (id ? stop() : void start())}
          >
            {starting ? "Starting…" : id ? "Stop" : "Start"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!id}
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setLines([])}
            title="Clear this viewer only; phone logs are unchanged"
          >
            Clear view
          </button>
        </div>
        <div className="android-logcat-toolbar">
          <input
            aria-label="Filter device logs"
            placeholder="Filter text, tag or PID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Minimum log priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {[
              ["V", "Verbose"],
              ["D", "Debug"],
              ["I", "Info"],
              ["W", "Warning"],
              ["E", "Error"],
              ["F", "Fatal"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />{" "}
            Follow
          </label>
        </div>
        <p className="android-logcat-hint">
          USB debugging + phone authorization required. No app launch needed.
          Local devices only; logs stay in memory. Closing stops capture.
        </p>
        {error && (
          <div className="android-logcat-error" role="alert">
            {error}
          </div>
        )}
        {!devices.length && !loading && (
          <p className="android-logcat-hint">
            No devices found. Connect your phone, authorize this computer, then
            refresh.
          </p>
        )}
        <div
          className="android-logcat-output"
          ref={output}
          aria-label="Logcat output"
          tabIndex={0}
        >
          {visible.map((line) => (
            <div key={line.seq} data-priority={line.priority}>
              {line.text}
            </div>
          ))}
        </div>
        <div className="android-logcat-hint" role="status">
          {id
            ? paused
              ? "Paused — device reader still collecting"
              : "Live"
            : "Stopped"}{" "}
          · {visible.length} shown · {lines.length}/2000 retained
        </div>
      </section>
    </FloatingDialog>
  );
}
