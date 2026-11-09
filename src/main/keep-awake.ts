import { app, powerSaveBlocker } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  createKeepAwake,
  keepAwakeWanted,
  parseKeepAwakeMode,
  type KeepAwakeMode,
  type KeepAwakeState,
} from "../shared/keep-awake";

/**
 * Main-process owner of the keep-awake preference and its one native blocker.
 *
 * The mode is device-local (each computer keeps its own) and persisted under
 * userData so a cold launch restores an "always" blocker without the renderer
 * visiting Settings. Electron releases the blocker on quit.
 */
let mode: KeepAwakeMode | null = null;
let workingCount = 0;
const blocker = createKeepAwake(powerSaveBlocker);

function storePath(): string {
  return join(app.getPath("userData"), "keep-awake.json");
}

function readStoredMode(): KeepAwakeMode {
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_KEEP_AWAKE_MODE;
    const record = parsed as Record<string, unknown>;
    return parseKeepAwakeMode(record.mode) ?? parseKeepAwakeMode(record.on) ?? DEFAULT_KEEP_AWAKE_MODE;
  } catch {
    return DEFAULT_KEEP_AWAKE_MODE;
  }
}

function currentMode(): KeepAwakeMode {
  return mode ??= readStoredMode();
}

function apply(): void {
  blocker.set(keepAwakeWanted(currentMode(), workingCount > 0));
}

/** Restore the persisted mode at launch, before any window exists. */
export function initKeepAwake(): void {
  try {
    apply();
  } catch (error) {
    // A headless/unsupported platform must not take the app down with it.
    console.error("[KEEP AWAKE]", error);
  }
}

export function getKeepAwakeState(): KeepAwakeState {
  return { mode: currentMode(), active: blocker.isActive() };
}

export function setKeepAwakeMode(value: unknown): KeepAwakeState {
  const next = parseKeepAwakeMode(value);
  if (!next) return getKeepAwakeState();
  mode = next;
  try {
    const dir = app.getPath("userData");
    mkdirSync(dir, { recursive: true });
    const path = storePath();
    writeFileSync(`${path}.tmp`, JSON.stringify({ mode: next }, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
  } catch (error) {
    console.error("[KEEP AWAKE] could not persist mode", error);
  }
  apply();
  return getKeepAwakeState();
}

/**
 * Renderers report whether a turn is in flight. The count keeps two windows
 * (or a turn plus a retry) from releasing the blocker early.
 */
export function setKeepAwakeWorking(working: unknown): KeepAwakeState {
  workingCount = typeof working === "boolean"
    ? working ? workingCount + 1 : Math.max(0, workingCount - 1)
    : 0;
  apply();
  return getKeepAwakeState();
}
