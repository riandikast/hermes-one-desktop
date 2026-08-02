export const ZOOM_MIN = -3.5;
export const ZOOM_MAX = 3.5;
export const ZOOM_STEP = 0.5;

export function clampZoomLevel(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

export function nextZoomLevel(current: number, delta: number): number {
  return clampZoomLevel(current + delta * ZOOM_STEP);
}

export interface ZoomTarget {
  webContents: {
    getZoomLevel(): number;
    setZoomLevel(level: number): void;
    send(channel: string, level: number): void;
  };
}

function applyAndNotify(target: ZoomTarget, level: number): number {
  const clamped = clampZoomLevel(level);
  target.webContents.setZoomLevel(clamped);
  target.webContents.send("ui-zoom-changed", clamped);
  return clamped;
}

export function zoomBy(target: ZoomTarget, delta: number): number {
  return applyAndNotify(
    target,
    nextZoomLevel(target.webContents.getZoomLevel(), delta),
  );
}

export function zoomReset(target: ZoomTarget): number {
  return applyAndNotify(target, 0);
}

export function zoomApply(target: ZoomTarget, level: number): number {
  return applyAndNotify(target, level);
}
