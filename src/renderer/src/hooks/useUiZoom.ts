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
      const { steps, remaining } = stepWheelDelta(acc, event.deltaY);
      acc = remaining;
      if (steps !== 0) {
        window.hermesAPI.zoomBy(steps).catch(() => undefined);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      unsubscribe();
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
}
