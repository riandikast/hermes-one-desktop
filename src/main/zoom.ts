export const ZOOM_MIN = -3.5;
export const ZOOM_MAX = 3.5;
export const ZOOM_STEP = 0.5;

export function clampZoomLevel(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

export function nextZoomLevel(current: number, delta: number): number {
  return clampZoomLevel(current + delta * ZOOM_STEP);
}
