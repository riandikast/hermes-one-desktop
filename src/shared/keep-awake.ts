/**
 * Keep-awake — hold one machine-global power-save blocker.
 *
 * `prevent-app-suspension` stops the system from sleeping (long unattended
 * agent runs keep going) while still letting the display dim. Mirrors the
 * official desktop's modes: never, only while a turn is in flight, or always.
 *
 * No electron imports here: the renderer imports the modes, while the main
 * process persists the mode and owns the native blocker (`main/keep-awake.ts`).
 */
export type KeepAwakeType = "prevent-app-suspension" | "prevent-display-sleep";

/** The slice of Electron's `powerSaveBlocker` we use (injected for testing). */
export interface PowerSaveBlockerLike {
  start(type: KeepAwakeType): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

export const KEEP_AWAKE_MODES = ["off", "while-working", "always"] as const;
export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number];

/** A laptop that sleeps mid-turn freezes the turn; idle costs nothing. */
export const DEFAULT_KEEP_AWAKE_MODE: KeepAwakeMode = "while-working";

export interface KeepAwakeState {
  /** Device-local; never written to config.yaml. */
  mode: KeepAwakeMode;
  /** True while the native blocker is actually held. */
  active: boolean;
}

/** Coerce a persisted/wire value to a mode; a legacy boolean meant on = always. */
export function parseKeepAwakeMode(value: unknown): KeepAwakeMode | null {
  if (value === true) return "always";
  if (value === false) return "off";
  return typeof value === "string" && (KEEP_AWAKE_MODES as readonly string[]).includes(value)
    ? (value as KeepAwakeMode)
    : null;
}

/** Whether the blocker should be held right now, given the mode and live turn picture. */
export function keepAwakeWanted(mode: KeepAwakeMode, working: boolean): boolean {
  return mode === "always" || (mode === "while-working" && working);
}

/** Idempotent on/off wrapper so repeated mode changes cannot leak blockers. */
export function createKeepAwake(
  blocker: PowerSaveBlockerLike,
  type: KeepAwakeType = "prevent-app-suspension",
): { set(on: boolean): boolean; isActive(): boolean } {
  let id: null | number = null;
  const isActive = (): boolean => id !== null && blocker.isStarted(id);
  return {
    isActive,
    set(on) {
      if (on && !isActive()) {
        id = blocker.start(type);
      } else if (!on && id !== null) {
        if (blocker.isStarted(id)) blocker.stop(id);
        id = null;
      }
      return isActive();
    },
  };
}
