/**
 * Desktop notification preferences (device-local).
 *
 * Mirrors the official desktop's Settings → Notifications split: a master
 * switch, per-kind toggles and a completion-sound switch. Stored by the main
 * process under the app's userData — never in config.yaml — because it governs
 * this computer's shell, not the agent.
 */
export interface NotificationPrefs {
  /** Master switch: off silences OS notifications and the finish chime. */
  enabled: boolean;
  /** Notify when a turn finishes while the window is in the background. */
  onTurnComplete: boolean;
  /** Notify when a turn fails. */
  onTurnError: boolean;
  /** Play the in-app finish chime when a turn ends. */
  soundEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  onTurnComplete: true,
  onTurnError: true,
  soundEnabled: true,
};

const BOOLEAN_KEYS = [
  "enabled",
  "onTurnComplete",
  "onTurnError",
  "soundEnabled",
] as const satisfies ReadonlyArray<keyof NotificationPrefs>;

/** Coerce whatever is on disk / on the wire; unknown keys are dropped. */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const record = (raw ?? {}) as Record<string, unknown>;
  const next: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof record[key] === "boolean") next[key] = record[key] as boolean;
  }
  // An older build may have stored a bare boolean for the master switch.
  if (typeof record.enabled === "boolean") next.enabled = record.enabled;
  return next;
}

export type NotificationKind = "turn-complete" | "turn-error" | "test";

/** Whether `kind` should reach the OS right now. */
export function notificationAllowed(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  if (!prefs.enabled) return false;
  if (kind === "turn-complete") return prefs.onTurnComplete;
  if (kind === "turn-error") return prefs.onTurnError;
  return true;
}
