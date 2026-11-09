import { app, Notification } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationAllowed,
  parseNotificationPrefs,
  type NotificationKind,
  type NotificationPrefs,
} from "../shared/notifications";

/**
 * Main-process owner of the desktop-notification switches and the only place
 * that raises an OS notification, so the renderer cannot bypass the user's
 * choices.
 */
let cached: NotificationPrefs | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "notifications.json");
}

export function getNotificationPrefs(): NotificationPrefs {
  if (cached) return cached;
  try {
    cached = parseNotificationPrefs(JSON.parse(readFileSync(storePath(), "utf8")));
  } catch {
    cached = { ...DEFAULT_NOTIFICATION_PREFS };
  }
  return cached;
}

export function setNotificationPrefs(value: unknown): NotificationPrefs {
  const next = parseNotificationPrefs(value);
  cached = next;
  try {
    const dir = app.getPath("userData");
    mkdirSync(dir, { recursive: true });
    const path = storePath();
    writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
  } catch (error) {
    console.error("[NOTIFICATIONS] could not persist preferences", error);
  }
  return next;
}

export interface DesktopNotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
}

/**
 * Raise an OS notification when the user allows that kind. Returns whether one
 * was actually shown, so a "Test notification" action can report the truth.
 */
export function showDesktopNotification(input: DesktopNotificationInput): boolean {
  const prefs = getNotificationPrefs();
  if (!notificationAllowed(prefs, input.kind)) return false;
  if (!Notification.isSupported()) return false;
  try {
    new Notification({ title: input.title, body: input.body.slice(0, 200) }).show();
    return true;
  } catch (error) {
    console.error("[NOTIFICATIONS] could not show notification", error);
    return false;
  }
}
