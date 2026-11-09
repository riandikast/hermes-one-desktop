import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationAllowed,
  parseNotificationPrefs,
} from "./notifications";

describe("notification preferences", () => {
  it("defaults to every alert and the chime on", () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({
      enabled: true,
      onTurnComplete: true,
      onTurnError: true,
      soundEnabled: true,
    });
  });

  it("keeps known booleans and drops junk", () => {
    expect(
      parseNotificationPrefs({
        enabled: false,
        onTurnComplete: true,
        onTurnError: "yes",
        soundEnabled: 0,
        extra: "ignored",
      }),
    ).toEqual({
      enabled: false,
      onTurnComplete: true,
      onTurnError: true,
      soundEnabled: true,
    });
    expect(parseNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("gates each kind behind the master switch", () => {
    const en = DEFAULT_NOTIFICATION_PREFS;
    expect(notificationAllowed(en, "turn-complete")).toBe(true);
    expect(notificationAllowed(en, "turn-error")).toBe(true);
    expect(notificationAllowed(en, "test")).toBe(true);
    expect(notificationAllowed({ ...en, enabled: false }, "test")).toBe(false);
    expect(notificationAllowed({ ...en, onTurnComplete: false }, "turn-complete")).toBe(false);
    expect(notificationAllowed({ ...en, onTurnError: false }, "turn-error")).toBe(false);
    // The test action ignores the per-kind switches; it is an explicit ask.
    expect(notificationAllowed({ ...en, onTurnComplete: false }, "test")).toBe(true);
  });
});
