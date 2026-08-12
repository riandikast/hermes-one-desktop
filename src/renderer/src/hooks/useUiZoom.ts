import { useEffect } from "react";
import { stepWheelDelta } from "./zoomWheel";

const ZOOM_STORAGE_KEY = "hermes.ui.zoomLevel";

export function useUiZoom(): void {
  useEffect(() => {
    const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isFinite(stored) && stored !== 0) {
      window.hermesAPI.zoomApply(stored).catch(() => undefined);
    }

    const unsubscribe = window.hermesAPI.onUiZoomChanged((level) => {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
    });

    let acc = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.shiftKey) return;
      event.preventDefault();
      // When Shift is held, Chromium converts vertical scroll (deltaY) to horizontal scroll (deltaX).
      const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (!rawDelta) return;
      const { steps, remaining } = stepWheelDelta(acc, rawDelta);
      acc = remaining;
      if (steps !== 0) {
        // Wheel-up is a NEGATIVE deltaY; zooming should follow the gesture
        // (up = zoom in), so the step sign is inverted for zoomBy().
        window.hermesAPI.zoomBy(-steps).catch(() => undefined);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "=" || event.key === "+" || event.code === "Equal" || event.code === "NumpadAdd") {
        event.preventDefault();
        window.hermesAPI.zoomBy(1).catch(() => undefined);
      } else if (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract") {
        event.preventDefault();
        window.hermesAPI.zoomBy(-1).catch(() => undefined);
      } else if (event.key === "0" || event.code === "Digit0") {
        event.preventDefault();
        window.hermesAPI.zoomApply(0).catch(() => undefined);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      unsubscribe();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
