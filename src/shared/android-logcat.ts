export interface AndroidDevice {
  serial: string;
  state: string;
  label: string;
}

export interface LogcatLine {
  seq: number;
  text: string;
  priority: string;
}

export interface LogcatSnapshot {
  lines: LogcatLine[];
  running: boolean;
  error?: string;
}

export type LogcatStartResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
