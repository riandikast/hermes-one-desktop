import { execFile, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { randomUUID } from "crypto";
import type {
  AndroidDevice,
  LogcatLine,
  LogcatSnapshot,
} from "../shared/android-logcat";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

function adbPath(): string {
  const name = process.platform === "win32" ? "adb.exe" : "adb";
  for (const root of [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  ]) {
    if (root && existsSync(join(root, "platform-tools", name)))
      return join(root, "platform-tools", name);
  }
  return name;
}

function adbError(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT"
    ? "ADB not found. Install Android SDK Platform-Tools and add it to PATH, or set ANDROID_HOME."
    : (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export function parseAndroidDevices(output: string): AndroidDevice[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match =
      /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader)(?:\s+(.*))?$/.exec(
        line,
      );
    if (!match) return [];
    const model = /(?:^|\s)model:(\S+)/.exec(match[3] ?? "")?.[1];
    return [
      {
        serial: match[1],
        state: match[2],
        label: model?.replace(/_/g, " ") || match[1],
      },
    ];
  });
}

export function listAndroidDevices(): Promise<{
  devices: AndroidDevice[];
  error?: string;
}> {
  return new Promise((resolve) => {
    execFile(
      adbPath(),
      ["devices", "-l"],
      {
        ...HIDDEN_SUBPROCESS_OPTIONS,
        timeout: 10000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        resolve(
          error
            ? { devices: [], error: adbError(error) }
            : { devices: parseAndroidDevices(stdout) },
        );
      },
    );
  });
}

interface Capture {
  owner: number;
  child: ChildProcess;
  lines: LogcatLine[];
  seq: number;
  running: boolean;
  error?: string;
}
const captures = new Map<string, Capture>();

export function startAndroidLogcat(owner: number, serial: unknown): string {
  if (
    typeof serial !== "string" ||
    !/^[A-Za-z0-9_.:[\]-]{1,256}$/.test(serial) ||
    serial.startsWith("-")
  )
    throw new Error("Invalid Android device serial");
  if (captures.size >= 4)
    throw new Error("Stop another Logcat capture first (maximum four).");
  // Read buffered + new logs. Never launch an app, clear device logs, root ADB,
  // or terminate the user's shared ADB server.
  const child = spawn(
    adbPath(),
    ["-s", serial, "logcat", "-v", "threadtime", "-T", "500"],
    {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const id = randomUUID();
  const capture: Capture = { owner, child, lines: [], seq: 0, running: true };
  captures.set(id, capture);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const append = (text: string): void => {
    if (!text) return;
    const priority =
      /^\s*\d\d-\d\d\s+\S+\s+\d+\s+\d+\s+([VDIWEFAS])\s/.exec(text)?.[1] ?? "I";
    capture.lines.push({
      seq: ++capture.seq,
      text: text.slice(0, 4096),
      priority,
    });
    if (capture.lines.length > 2000)
      capture.lines.splice(0, capture.lines.length - 2000);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    pending += decoder.write(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) append(line);
    // Bound even a device producing an unterminated line.
    if (pending.length > 4096) {
      append(pending);
      pending = "";
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    capture.error = ((capture.error ?? "") + chunk.toString("utf8")).slice(
      -1000,
    );
  });
  child.once("error", (error) => {
    capture.error = adbError(error);
    capture.running = false;
  });
  child.once("close", (code) => {
    append(pending + decoder.end());
    capture.running = false;
    if (code && !capture.error) capture.error = `ADB exited with code ${code}`;
  });
  return id;
}

export function readAndroidLogcat(
  owner: number,
  id: unknown,
  after: unknown,
): LogcatSnapshot {
  const capture = typeof id === "string" ? captures.get(id) : undefined;
  if (!capture || capture.owner !== owner)
    throw new Error("Logcat capture not found");
  if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)
    throw new Error("Invalid Logcat cursor");
  return {
    lines: capture.lines.filter((line) => line.seq > after).slice(-500),
    running: capture.running,
    error: capture.error,
  };
}

export function stopAndroidLogcat(owner: number, id: unknown): void {
  const capture = typeof id === "string" ? captures.get(id) : undefined;
  if (!capture || capture.owner !== owner) return;
  captures.delete(id as string);
  if (capture.running) capture.child.kill();
}

export function stopOwnedAndroidLogcats(owner: number): void {
  for (const [id, capture] of captures)
    if (capture.owner === owner) stopAndroidLogcat(owner, id);
}
